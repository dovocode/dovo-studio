import { type PullCodeReview, type TitleGenerationSettings } from '@dovo/protocol'
import { runPullReview, type PullReviewProgress } from './pull-review-engine.js'
import { orchestratePullReview } from './pull-review-orchestrator.js'
import { errorMessage } from '../../errors.js'

type Reviewer = NonNullable<PullCodeReview['reviewerResults']>[number]
type Result = PullReviewProgress & { reviewerResults: Reviewer[] }

/** Merge only exact findings. Independent reports never count as proof. */
function combinePullReviewers(
  review: PullCodeReview,
  results: PullReviewProgress[],
  reviewers: Reviewer[],
): Result {
  const findings: PullCodeReview['findings'] = []
  const known = new Map<string, PullCodeReview['findings'][number]>()
  for (const [index, result] of results.entries()) {
    for (const finding of result.findings) {
      const key = JSON.stringify([
        finding.path,
        finding.side,
        finding.line,
        finding.evidence,
        finding.title.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim(),
      ])
      const prior = known.get(key)
      if (prior) prior.reviewerIds?.push(reviewers[index].id)
      else {
        const next = { ...finding, reviewerIds: [reviewers[index].id] }
        known.set(key, next)
        findings.push(next)
      }
    }
  }
  const severity = { high: 0, medium: 1, low: 2 }
  findings.sort(
    (a, b) =>
      severity[a.severity] - severity[b.severity] || (b.confidence ?? 0) - (a.confidence ?? 0),
  )
  const coverage = review.coverage.map((file) => {
    if (file.state !== 'supplied') return { ...file }
    const states = results.map(
      (result) => result.coverage.find((item) => item.path === file.path)?.state,
    )
    const state = states.includes('supplied')
      ? 'supplied'
      : states.includes('queued') || reviewers.some((reviewer) => reviewer.status === 'pending')
        ? 'queued'
        : 'failed'
    return { ...file, state } satisfies PullCodeReview['coverage'][number]
  })
  const contextFiles = new Map<
    string,
    NonNullable<PullCodeReview['analysis']>['contextFiles'][number]
  >()
  for (const result of results)
    for (const file of result.analysis.contextFiles)
      contextFiles.set(JSON.stringify([file.path, file.ref]), file)
  const running = reviewers.findIndex((reviewer) => reviewer.status === 'running')
  const complete = reviewers.filter((reviewer) => reviewer.status === 'completed').length
  return {
    findings: findings.slice(0, 100),
    coverage,
    summary: `${findings.length > 100 ? 100 : findings.length} supported bug findings. ${complete} of ${reviewers.length} reviewers finished all batches. Inspect reviewer batch counts and file coverage before deciding.`,
    notVerified: [
      ...new Set([
        ...results.flatMap((result) => result.notVerified),
        ...reviewers.flatMap((reviewer) =>
          reviewer.error ? [`${reviewer.selection.model}: ${reviewer.error}`] : [],
        ),
        ...(findings.length > 100
          ? [`${findings.length - 100} additional findings were omitted by the report limit.`]
          : []),
        ...(reviewers.length > 1
          ? [
              'Matching findings are combined by exact location, evidence and title. Agreement between models does not prove correctness. Coverage shows patches supplied to at least one reviewer. Inspect the batch counts for each reviewer.',
            ]
          : []),
      ]),
    ],
    reviewerResults: structuredClone(reviewers),
    analysis: {
      batches: reviewers.reduce((n, reviewer) => n + reviewer.batches, 0),
      completedBatches: reviewers.reduce((n, reviewer) => n + reviewer.completedBatches, 0),
      phase: running >= 0 ? (results[running]?.analysis.phase ?? 'reviewing') : 'completed',
      activeBatch:
        running >= 0 && results[running]?.analysis.activeBatch !== undefined
          ? reviewers.slice(0, running).reduce((n, reviewer) => n + reviewer.batches, 0) +
            results[running].analysis.activeBatch
          : undefined,
      rejectedFindings: results.reduce((n, result) => n + result.analysis.rejectedFindings, 0),
      contextFiles: [...contextFiles.values()],
    },
  }
}

export async function runPullReviewers({
  review,
  call,
  readSnapshot,
  signal,
  progress,
}: {
  review: PullCodeReview
  call: (
    text: string,
    phase: 'review' | 'check' | 'combine',
    selection: TitleGenerationSettings,
  ) => Promise<string>
  readSnapshot?: (path: string, ref: string) => Promise<string | undefined>
  signal: AbortSignal
  progress: (result: Result) => void
}): Promise<Result> {
  const selections = [review.selection, ...(review.reviewers ?? [])]
  const batches = new Set(
    review.coverage.filter((file) => file.state === 'supplied').map((file) => file.batch ?? 0),
  ).size
  const reviewers: Reviewer[] = selections.map((selection, index) => ({
    id: `reviewer-${index + 1}`,
    selection,
    status: 'pending',
    batches,
    completedBatches: 0,
  }))
  const results: PullReviewProgress[] = selections.map(() => ({
    summary: '',
    findings: [],
    coverage: review.coverage.map((file) =>
      file.state === 'supplied' ? { ...file, state: 'queued' } : { ...file },
    ),
    notVerified: [],
    analysis: {
      batches,
      completedBatches: 0,
      phase: 'reviewing',
      rejectedFindings: 0,
      contextFiles: [],
    },
  }))
  // Bound provider processes and cost. A provider failure does not discard other results.
  for (const [index, selection] of selections.entries()) {
    signal.throwIfAborted()
    reviewers[index].status = 'running'
    progress(combinePullReviewers(review, results, reviewers))
    try {
      results[index] = await runPullReview({
        review,
        intent: review.intent ?? { title: '', body: '' },
        call: (text, phase) => call(text, phase, selection),
        readSnapshot,
        signal,
        progress: (result) => {
          results[index] = result
          reviewers[index].completedBatches = result.analysis.completedBatches
          progress(combinePullReviewers(review, results, reviewers))
        },
      })
      reviewers[index].completedBatches = results[index].analysis.completedBatches
      reviewers[index].status =
        reviewers[index].completedBatches === batches ? 'completed' : 'partial'
    } catch (error) {
      signal.throwIfAborted()
      reviewers[index].status = 'failed'
      reviewers[index].error = errorMessage(error)
      results[index].coverage = results[index].coverage.map((file) =>
        file.state === 'queued' ? { ...file, state: 'failed' } : file,
      )
    }
    progress(combinePullReviewers(review, results, reviewers))
  }
  if (!reviewers.some((reviewer) => reviewer.completedBatches))
    throw new Error(
      reviewers
        .map((reviewer) => reviewer.error)
        .filter(Boolean)
        .join('\n') || 'No reviewer completed a batch.',
    )
  let combined = combinePullReviewers(review, results, reviewers)
  if (selections.length > 1 && combined.findings.length) {
    combined.analysis.phase = 'combining'
    delete combined.analysis.activeBatch
    progress(structuredClone(combined))
    combined = await orchestratePullReview(
      combined,
      (text) => call(text, 'combine', review.selection),
      signal,
    )
    combined.analysis.phase = 'completed'
    progress(structuredClone(combined))
  }
  return combined
}
