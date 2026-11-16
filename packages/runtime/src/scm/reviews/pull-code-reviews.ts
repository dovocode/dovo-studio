import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import {
  decode,
  mutableStruct,
  mutableArray,
  forgePullTarget,
  pullCodeReviewSchema,
  pullCodeReviewReportSchema,
  pullCodeReviewBody,
  pullReviewDepths,
  pullReviewDepthSchema,
  type PullCodeReview,
  type PullCodeReviewTarget,
  type PullCodeReviewDraft,
  type PullCodeReviewReport,
  type pullCodeReviewStartSchema,
} from '@dovo/protocol'
import type { Services } from '../../services.js'
import { HttpError, errorMessage } from '../../errors.js'
import { retrievalFresh } from '../../retrieval/context.js'
import { guardSource } from '../forges/integration/source-context.js'
import { pullReviewRevision } from './reviews.js'
import { pullReviewPlan } from './pull-review-engine.js'
import { runPullReviewers } from './pull-reviewers.js'
import { pullReviewImages } from './pull-review-images.js'
import { runPullChecks } from './pull-review-checks.js'
export { pullReviewEvidence } from './pull-review-engine.js'

const pullCodeReviewReportReviewersSchema = pullCodeReviewReportSchema.fields.reviewers
const row = mutableStruct({ value: Schema.String })
const rows = mutableArray(row)
const now = () => new Date().toISOString()
const emptyDraft = (): PullCodeReviewDraft => ({
  body: '',
  selected: [],
  dismissed: [],
  event: 'comment',
})

export class PullCodeReviews {
  private stopped = false
  private runs = new Set<Promise<void>>()
  private active = new Map<string, AbortController>()
  private publications = new Set<string>()
  private starts = new Set<string>()
  constructor(
    private db: Database.Database,
    private s: Pick<Services, 'pulls' | 'store' | 'titles' | 'activity' | 'git'>,
  ) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS pull_code_reviews (id TEXT PRIMARY KEY, scope TEXT NOT NULL, request_id TEXT NOT NULL, value TEXT NOT NULL, UNIQUE(scope,request_id)); CREATE INDEX IF NOT EXISTS pull_code_review_scope ON pull_code_reviews(scope)',
    )
    for (const value of decode(rows, db.prepare('SELECT value FROM pull_code_reviews').all())) {
      const review = decode(pullCodeReviewSchema, JSON.parse(value.value))
      let changed = false
      if (review.status === 'running') {
        review.status = 'interrupted'
        review.finishedAt = now()
        changed = true
      }
      for (const reviewer of review.reviewerResults ?? []) {
        if (reviewer.status === 'running' || reviewer.status === 'pending') {
          reviewer.status = 'interrupted'
          changed = true
        }
      }
      for (const check of review.checks ?? []) {
        if (check.status === 'running') {
          check.status = 'interrupted'
          check.finishedAt = now()
          check.output += '\nRuntime stopped before this command result was saved.'
          check.output = check.output.slice(-20000)
          changed = true
        }
      }
      if (review.publication?.status === 'publishing') {
        review.publication.status = 'unknown'
        changed = true
      }
      if (changed) this.write(review)
    }
  }
  private write(review: PullCodeReview) {
    review.sequence++
    this.db
      .prepare('UPDATE pull_code_reviews SET value=? WHERE id=?')
      .run(JSON.stringify(review), review.id)
  }
  private async source(target: PullCodeReviewTarget) {
    const repo = this.s.store.get().repositories.find((item) => item.id === target.repositoryId)
    if (repo?.kind) throw new HttpError(400, 'Choose a Git project.')
    if (repo) {
      const source = await this.s.pulls.guard(repo.path, {
        expectedDestination: target.expectedDestination,
      })
      if (target.connectionId && source.connection?.id !== target.connectionId)
        throw new HttpError(409, 'The PR account changed. Refresh before continuing.')
      return {
        source,
        repository: repo.path,
        overview: () =>
          this.s.pulls.section(repo.path, target.number, 'overview', source.destination),
        readSnapshot: async (path: string, ref: string) => {
          if (!/^[a-f0-9]{40,64}$/i.test(ref)) return undefined
          try {
            const preview = await this.s.git.checkpointFilePreview(repo.path, undefined, ref, path)
            return preview.after?.kind === 'text' && !preview.after.truncated
              ? preview.after.text
              : undefined
          } catch (error) {
            if (error instanceof HttpError && error.status === 404) return undefined
            throw error
          }
        },
        changes: () =>
          this.s.pulls.section(repo.path, target.number, 'changes', source.destination),
        status: () => this.s.pulls.status(repo.path, target.number, false, source.destination),
        feedback: () => this.s.pulls.feedback(repo.path, target.number, source.destination),
        act: (input: Parameters<Services['pulls']['act']>[1]) => this.s.pulls.act(repo.path, input),
      }
    }
    const parsed = forgePullTarget(target.repositoryId)
    if (!parsed || parsed.number !== target.number) throw new HttpError(404, 'PR source not found.')
    const reader = this.s.pulls.urlTarget(target.repositoryId, target.connectionId)
    const source = await reader.sourceContext()
    guardSource(source, { expectedDestination: target.expectedDestination })
    return {
      source,
      repository: undefined,
      overview: () => reader.section(target.number, 'overview', source.destination),
      readSnapshot: undefined,
      changes: () => reader.section(target.number, 'changes', source.destination),
      status: () => reader.status(target.number, false, source.destination),
      feedback: () => reader.feedback(target.number, source.destination),
      act: reader.act,
    }
  }
  private scope(target: PullCodeReviewTarget, readerIdentity: string) {
    return JSON.stringify([target.expectedDestination, readerIdentity, target.number])
  }
  private list(scope: string) {
    return decode(
      rows,
      this.db
        .prepare('SELECT value FROM pull_code_reviews WHERE scope=? ORDER BY rowid DESC')
        .all(scope),
    ).map((item) => decode(pullCodeReviewSchema, JSON.parse(item.value)))
  }
  private get(scope: string, id: string) {
    const found = this.list(scope).find((review) => review.id === id)
    if (!found) throw new HttpError(404, 'PR review not found for this account.')
    return found
  }
  async read(target: PullCodeReviewTarget): Promise<PullCodeReviewReport> {
    const { source } = await this.source(target)
    const selection = this.db
      .prepare("SELECT value FROM documents WHERE id='pull-review-model'")
      .get()
    const reviewers = this.db
      .prepare("SELECT value FROM documents WHERE id='pull-review-reviewers'")
      .get()
    const depth = this.db.prepare("SELECT value FROM documents WHERE id='pull-review-depth'").get()
    return {
      reviews: this.list(this.scope(target, source.readerIdentity)),
      ...(reviewers
        ? {
            reviewers: decode(
              pullCodeReviewReportReviewersSchema,
              JSON.parse(decode(row, reviewers).value),
            ),
          }
        : {}),
      ...(depth
        ? { depth: decode(pullReviewDepthSchema, JSON.parse(decode(row, depth).value)) }
        : {}),
      ...(selection
        ? {
            selection: decode(
              pullCodeReviewSchema.fields.selection,
              JSON.parse(decode(row, selection).value),
            ),
          }
        : {}),
    }
  }
  async start(input: typeof pullCodeReviewStartSchema.Type) {
    if (this.stopped) throw new HttpError(503, 'The runtime is stopping.')
    const images = await pullReviewImages(input.images ?? [])
    const imageMetadata = images.map(({ data: _data, ...metadata }) => metadata)
    const reader = await this.source(input.target)
    const scope = this.scope(input.target, reader.source.readerIdentity)
    const prior = this.list(scope).find((review) => review.requestId === input.requestId)
    if (prior) {
      if (
        prior.headSha !== input.headSha ||
        prior.baseSha !== input.baseSha ||
        prior.remainingFrom !== input.remainingFrom ||
        (prior.depth ?? 'standard') !== (input.depth ?? 'standard') ||
        (prior.runChecks ?? false) !== (input.runChecks ?? false) ||
        !isDeepStrictEqual(prior.reviewers ?? [], input.reviewers ?? []) ||
        !isDeepStrictEqual(prior.images ?? [], imageMetadata) ||
        !isDeepStrictEqual(
          prior.selection,
          decode(
            pullCodeReviewSchema.fields.selection,
            JSON.parse(JSON.stringify(input.selection)),
          ),
        )
      )
        throw new HttpError(
          409,
          'This start request belongs to another revision or reviewer. Start a new review.',
        )
      return this.read(input.target)
    }
    if (this.starts.has(scope) || this.list(scope).some((review) => review.status === 'running'))
      throw new HttpError(409, 'A review is already running for this PR.')
    const selections = [input.selection, ...(input.reviewers ?? [])]
    const fingerprints = selections.map((selection) => {
      this.s.titles.validateUtility(selection)
      return JSON.stringify(selection)
    })
    if (new Set(fingerprints).size !== fingerprints.length)
      throw new HttpError(400, 'Choose distinct reviewer models or settings.')
    this.starts.add(scope)
    try {
      const before = await retrievalFresh(true, () => reader.status())
      const overview = await retrievalFresh(true, () => reader.overview())
      const detail = await retrievalFresh(true, () => reader.changes())
      const latest = await retrievalFresh(true, () => reader.status())
      if (
        detail.stale ||
        detail.refreshError ||
        latest.stale ||
        detail.warnings.some((warning) => warning.startsWith('Files:'))
      )
        throw new HttpError(503, 'PR patches are unavailable. Refresh and try again.')
      if (
        overview.pull.headSha !== input.headSha ||
        overview.pull.baseSha !== input.baseSha ||
        before.pull.headSha !== input.headSha ||
        before.pull.baseSha !== input.baseSha ||
        !detail.pull.headSha ||
        !detail.pull.baseSha ||
        detail.pull.headSha !== input.headSha ||
        detail.pull.baseSha !== input.baseSha ||
        latest.pull.headSha !== input.headSha ||
        latest.pull.baseSha !== input.baseSha
      )
        throw new HttpError(409, 'This PR changed. Refresh before starting a review.')
      const revision = pullReviewRevision(detail)
      const previous = new Set<string>()
      if (input.remainingFrom) {
        const original = this.get(scope, input.remainingFrom)
        if (original.revision !== revision)
          throw new HttpError(409, 'The patches changed. Start a review of the current revision.')
        for (const pass of this.list(scope).filter(
          (pass) => pass.revision === revision && pass.status === 'completed',
        ))
          for (const file of pass.coverage) if (file.state === 'supplied') previous.add(file.path)
      }
      const depth = input.depth ?? 'standard'
      const evidence = pullReviewPlan(detail, previous, undefined, pullReviewDepths[depth].batches)
      if (!evidence.coverage.some((file) => file.state === 'supplied'))
        throw new HttpError(
          400,
          'No more available patches fit this review. Inspect missing or oversized files in the repository.',
        )
      const review: PullCodeReview = {
        id: randomUUID(),
        requestId: input.requestId,
        remainingFrom: input.remainingFrom,
        revision,
        version: 0,
        sequence: 0,
        url: detail.pull.url,
        destination: reader.source.destination,
        readerIdentity: reader.source.readerIdentity,
        account:
          reader.source.viewerLogin ?? reader.source.connection?.name ?? 'Current forge account',
        baseSha: input.baseSha,
        headSha: input.headSha,
        selection: input.selection,
        reviewers: input.reviewers ?? [],
        images: imageMetadata,
        reviewerResults: selections.map((selection, index) => ({
          id: `reviewer-${index + 1}`,
          selection,
          status: 'pending',
          batches: new Set(
            evidence.coverage
              .filter((file) => file.state === 'supplied')
              .map((file) => file.batch ?? 0),
          ).size,
          completedBatches: 0,
        })),
        depth,
        runChecks: input.runChecks ?? false,
        checks: [],
        createdAt: now(),
        status: 'running',
        summary: '',
        notVerified: [],
        findings: [],
        ...evidence,
        intent: { title: overview.pull.title, body: overview.pull.body.slice(0, 8000) },
        draft: emptyDraft(),
      }
      this.db
        .prepare('INSERT INTO pull_code_reviews(id,scope,request_id,value) VALUES(?,?,?,?)')
        .run(review.id, scope, review.requestId, JSON.stringify(review))
      this.db
        .prepare("INSERT OR REPLACE INTO documents(id,value) VALUES('pull-review-model',?)")
        .run(JSON.stringify(input.selection))
      this.db
        .prepare("INSERT OR REPLACE INTO documents(id,value) VALUES('pull-review-depth',?)")
        .run(JSON.stringify(depth))
      this.db
        .prepare("INSERT OR REPLACE INTO documents(id,value) VALUES('pull-review-reviewers',?)")
        .run(JSON.stringify(input.reviewers ?? []))
      const controller = new AbortController()
      this.active.set(review.id, controller)
      const done = this.run(review, scope, reader, controller, images).finally(() => {
        this.active.delete(review.id)
        this.runs.delete(done)
      })
      this.runs.add(done)
      return this.read(input.target)
    } finally {
      this.starts.delete(scope)
    }
  }
  private async run(
    review: PullCodeReview,
    scope: string,
    reader: Awaited<ReturnType<PullCodeReviews['source']>>,
    controller: AbortController,
    images: Awaited<ReturnType<typeof pullReviewImages>>,
  ) {
    try {
      if (review.runChecks) {
        review.checks = await runPullChecks({
          repository: reader.repository,
          headSha: review.headSha,
          git: this.s.git,
          signal: controller.signal,
          progress: (checks) => {
            const current = this.get(scope, review.id)
            current.checks = checks
            this.write(current)
          },
        })
      }
      controller.signal.throwIfAborted()
      const result = await runPullReviewers({
        review,
        call: (text, phase, selection) =>
          this.s.titles.reviewPull(text, selection, controller.signal, phase, images),
        readSnapshot: reader.readSnapshot,
        signal: controller.signal,
        progress: (progress) => {
          const current = this.get(scope, review.id)
          Object.assign(current, progress)
          this.write(current)
        },
      })
      controller.signal.throwIfAborted()
      const revisionNotes: string[] = []
      try {
        const latest = await retrievalFresh(true, () => reader.status())
        if (latest.pull.headSha !== review.headSha || latest.pull.baseSha !== review.baseSha)
          revisionNotes.push(
            'The PR changed during this review. This report is for an older revision.',
          )
      } catch (error) {
        revisionNotes.push(`Could not check the latest revision: ${errorMessage(error)}`)
      }
      controller.signal.throwIfAborted()
      const current = this.get(scope, review.id)
      Object.assign(current, result)
      current.notVerified.push(...revisionNotes)
      current.status = 'completed'
      current.finishedAt = now()
      this.write(current)
      this.s.activity.add('integration', review.url, 'PR review completed', {
        kind: 'pull-review',
        reviewId: review.id,
        url: review.url,
        status: 'completed',
      })
    } catch (error) {
      const current = this.get(scope, review.id)
      current.status = controller.signal.aborted ? 'cancelled' : 'failed'
      for (const reviewer of current.reviewerResults ?? [])
        if (reviewer.status === 'running' || reviewer.status === 'pending')
          reviewer.status = controller.signal.aborted ? 'cancelled' : 'failed'
      current.error = errorMessage(error)
      current.finishedAt = now()
      this.write(current)
      this.s.activity.add('integration', review.url, 'PR review failed', {
        kind: 'pull-review',
        reviewId: review.id,
        url: review.url,
        status: current.status,
        error: current.error,
      })
    }
  }
  async stop(target: PullCodeReviewTarget, reviewId: string) {
    const { source } = await this.source(target)
    const review = this.get(this.scope(target, source.readerIdentity), reviewId)
    this.active.get(review.id)?.abort(new Error('PR review cancelled.'))
    return this.read(target)
  }
  async save(
    target: PullCodeReviewTarget,
    reviewId: string,
    version: number,
    draft: PullCodeReviewDraft,
  ) {
    const { source } = await this.source(target)
    const review = this.get(this.scope(target, source.readerIdentity), reviewId)
    if (review.version !== version || review.publication)
      throw new HttpError(409, 'This draft changed or was submitted. Refresh before editing.')
    const known = new Set(review.findings.map((finding) => finding.id))
    if ([...draft.selected, ...draft.dismissed].some((id) => !known.has(id)))
      throw new HttpError(400, 'Choose findings from this report.')
    review.draft = draft
    review.version++
    this.write(review)
    return this.read(target)
  }
  async publish(
    target: PullCodeReviewTarget,
    reviewId: string,
    version: number,
    requestId: string,
    body: string,
  ) {
    const reader = await this.source(target)
    const scope = this.scope(target, reader.source.readerIdentity)
    let review = this.get(scope, reviewId)
    if (this.publications.has(review.id))
      throw new HttpError(409, 'This review is being submitted. Wait for the result.')
    if (review.publication?.status === 'published') return this.read(target)
    this.publications.add(review.id)
    try {
      if (review.publication) {
        // A failed response never authorizes a second write. Reconcile by the durable marker.
        const feedback = await retrievalFresh(true, () => reader.feedback())
        const marker = `<!-- dovo-review:${review.id}:${review.headSha} -->`
        const posted = feedback.comments.find(
          (comment) => comment.kind === 'review' && comment.body.includes(marker),
        )
        if (posted) {
          review.publication.status = 'published'
          review.publication.url = posted.url
          if (review.publication.event === 'request-changes') {
            review.publication.pendingReviewDecision = 'request-changes'
            review.publication.notice =
              'Your review text was posted. Check the PR on the forge to confirm the request changes decision.'
          }
          this.write(review)
          return this.read(target)
        }
        throw new HttpError(
          409,
          'The publication outcome is unknown. No second review was posted. Check the PR on the forge before starting another review.',
        )
      }
      if (
        review.status !== 'completed' ||
        review.version !== version ||
        !review.draft.body.trim() ||
        pullCodeReviewBody(review) !== body
      )
        throw new HttpError(409, 'The preview changed. Save the draft and preview it again.')
      const detail = await retrievalFresh(true, () => reader.changes())
      const latest = await retrievalFresh(true, () => reader.status())
      review = this.get(scope, reviewId)
      if (review.version !== version || review.publication || pullCodeReviewBody(review) !== body)
        throw new HttpError(
          409,
          'The draft changed while checking the PR. Preview the saved draft again.',
        )
      if (
        detail.stale ||
        latest.stale ||
        pullReviewRevision(detail) !== review.revision ||
        latest.pull.headSha !== review.headSha ||
        latest.pull.baseSha !== review.baseSha
      )
        throw new HttpError(
          409,
          'The PR changed. Keep this draft and review the latest revision before submitting.',
        )
      guardSource(reader.source, {
        expectedDestination: review.destination,
        expectedReaderIdentity: review.readerIdentity,
      })
      const capabilities = latest.capabilities ?? detail.capabilities
      if (
        capabilities &&
        (!capabilities.actions.includes('review') ||
          !capabilities.reviewDecisions.includes(review.draft.event))
      )
        throw new HttpError(
          400,
          'This forge does not support the selected review decision. Choose a supported decision.',
        )
      review.publication = { requestId, body, event: review.draft.event, status: 'publishing' }
      this.write(review)
      try {
        const result = await reader.act({
          action: 'review',
          number: target.number,
          headSha: review.headSha,
          event: review.draft.event,
          body,
          expectedDestination: review.destination,
        })
        review.publication.status = 'published'
        review.publication.url = result.url
        review.publication.notice = result.message
        review.publication.pendingReviewDecision = result.pendingReviewDecision
      } catch (error) {
        review.publication.status = 'unknown'
        review.publication.error = errorMessage(error)
      }
      this.write(review)
      return this.read(target)
    } finally {
      this.publications.delete(review.id)
    }
  }
  async dispose() {
    this.stopped = true
    for (const controller of this.active.values())
      controller.abort(new Error('Runtime stopped during PR review.'))
    await Promise.allSettled(this.runs)
  }
}
