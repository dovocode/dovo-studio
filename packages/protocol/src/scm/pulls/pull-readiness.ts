import type { PullDetail } from './pulls.js'
import {
  checkSignal,
  latestPullReviews,
  pullChecks,
  pullDetailReviews,
  pullMergeability,
  type PullSignal,
  type PullTone,
} from './pull-presentation.js'

/** The same independently loaded resources used by both PR clients. */
type Resource = {
  ready: boolean
  error?: string
  readConnected?: boolean
  detail?: { stale?: boolean; refreshError?: string } | null
}
export type PullReadinessResources = Record<'status' | 'checks' | 'discussion', Resource>
export type PullReadinessMetric = {
  id: 'checks' | 'comments' | 'approvals'
  title: string
  signal: PullSignal
  segments: { tone: PullTone; count: number }[]
  description: string
}
function saved(resource: Resource) {
  return resource.readConnected === false || !!resource.detail?.stale
}
function unavailable(resource: Resource): PullSignal | undefined {
  if (resource.error || resource.detail?.refreshError)
    return { label: 'Unavailable', tone: 'warning' }
  if (!resource.ready)
    return {
      label: resource.readConnected === false ? 'Offline' : 'Details not loaded',
      tone: 'neutral',
    }
}
function segments(counts: ReadonlyArray<readonly [PullTone, number]>) {
  return counts.filter(([, count]) => count > 0).map(([tone, count]) => ({ tone, count }))
}
function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/** Bars describe known reports, threads and reviewers; they are not repository rule percentages. */
export function pullReadiness(detail: PullDetail, resources: PullReadinessResources) {
  const { status, checks, discussion } = resources
  const provider = pullMergeability(detail.pull)
  let headline = provider
  if (detail.pull.state === 'open' && !detail.pull.draft) {
    const missing = unavailable(status)
    if (missing)
      headline = {
        label:
          missing.tone === 'warning' ? 'Merge readiness unavailable' : 'Merge readiness pending',
        tone: missing.tone,
      }
    else if (saved(status) || detail.stale || detail.refreshError)
      headline = { label: 'Saved merge status', tone: 'warning' }
  }
  const description =
    headline.label === 'Saved merge status'
      ? 'Refresh to confirm the current merge requirements.'
      : headline.label === 'Merge readiness unavailable'
        ? 'Refresh status to load the repository’s merge requirements.'
        : headline.label === 'Ready to merge'
          ? 'The repository reports that merge requirements are met.'
          : detail.pull.state === 'merged'
            ? 'This pull request has been merged.'
            : detail.pull.state === 'closed'
              ? 'This pull request is closed.'
              : detail.pull.draft
                ? 'Mark this pull request ready when the changes can be reviewed.'
                : detail.pull.mergeStateStatus === 'BEHIND'
                  ? `Update this branch with ${detail.pull.base} on the server before merging.`
                  : headline.label === 'No merge conflicts'
                    ? 'No conflicts reported. Check the repository requirements before merging.'
                    : headline.label === 'Waiting for CI'
                      ? 'Checks are still running for this commit.'
                      : headline.label === 'Waiting for required reviews'
                        ? 'Waiting for the repository’s required reviews.'
                        : headline.label === 'Changes requested'
                          ? 'Address review feedback before merging.'
                          : headline.label === 'Merge conflicts'
                            ? 'Resolve branch conflicts before merging.'
                            : 'The server checks merge requirements before merging.'

  const checkCounts = new Map<PullTone, number>()
  if (checks.ready)
    for (const check of detail.checks) {
      const tone = checkSignal(check.status).tone
      checkCounts.set(tone, (checkCounts.get(tone) ?? 0) + 1)
    }
  const checkSegments = segments(
    (['positive', 'danger', 'warning', 'neutral'] as const).map((tone) => [
      tone,
      checkCounts.get(tone) ?? 0,
    ]),
  )
  const skipped = checks.ready
    ? detail.checks.filter((check) => check.status.toUpperCase() === 'SKIPPED').length
    : 0
  const other = (checkCounts.get('neutral') ?? 0) - skipped
  const checkLabel = [
    checkCounts.get('danger') ? `${checkCounts.get('danger')} failed` : '',
    checkCounts.get('warning') ? `${checkCounts.get('warning')} pending` : '',
    checkCounts.get('positive') ? `${checkCounts.get('positive')} passed` : '',
    skipped ? `${skipped} skipped` : '',
    other ? `${other} other` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  let checkStatus = unavailable(checks)
  if (
    !checks.ready &&
    !checks.error &&
    !checks.detail?.refreshError &&
    status.ready &&
    !unavailable(status) &&
    !saved(status)
  ) {
    const aggregate = pullChecks(detail.pull)
    checkStatus = { ...aggregate, label: `${aggregate.label} · details not loaded` }
  }

  const comments = detail.comments.filter((comment) => comment.kind !== 'review')
  const threads = new Map<string, boolean | undefined>()
  if (discussion.ready) {
    for (const comment of comments) {
      if (comment.kind !== 'inline') continue
      const id = comment.threadId ?? comment.replyTo ?? comment.id
      // A reply without resolution metadata must not erase a known thread state.
      if (!threads.has(id) || comment.resolved !== undefined) {
        const previous = threads.get(id)
        threads.set(id, previous === false ? false : comment.resolved)
      }
    }
  }
  const resolved = [...threads.values()].filter((value) => value === true).length
  const unresolved = [...threads.values()].filter((value) => value === false).length
  const unknown = threads.size - resolved - unresolved
  const commentLabel =
    [
      unresolved ? `${unresolved} unresolved` : '',
      resolved ? `${resolved} resolved` : '',
      unknown ? `${unknown} with unknown status` : '',
    ]
      .filter(Boolean)
      .join(' · ') || (comments.length ? plural(comments.length, 'comment') : 'No comments')
  let commentStatus = unavailable(discussion)
  if (
    !discussion.ready &&
    !discussion.error &&
    !discussion.detail?.refreshError &&
    detail.pull.commentCount != null
  )
    commentStatus = {
      label: `${plural(detail.pull.commentCount, 'comment')} · details not loaded`,
      tone: 'neutral',
    }

  const reviews = discussion.ready ? latestPullReviews(detail.comments) : []
  const approved = reviews.filter((review) =>
    ['APPROVED', 'APPROVED_WITH_SUGGESTIONS'].includes(review.state ?? ''),
  ).length
  const changes = reviews.filter((review) => review.state === 'CHANGES_REQUESTED').length
  const waiting = new Set(
    reviews
      .filter((review) => review.state === 'WAITING_FOR_AUTHOR')
      .map((review) => review.author),
  )
  const decided = new Set(
    reviews.filter((review) => review.state !== 'DISMISSED').map((review) => review.author),
  )
  for (const reviewer of detail.pull.reviewers) if (!decided.has(reviewer)) waiting.add(reviewer)
  const approvalLabel = [
    approved ? `${approved} approved` : '',
    changes ? `${changes} requested changes` : '',
    waiting.size ? `${waiting.size} pending` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const reviewSignal = pullDetailReviews(detail)
  let approvalStatus = unavailable(discussion)
  if (
    !discussion.ready &&
    !discussion.error &&
    !discussion.detail?.refreshError &&
    status.ready &&
    !unavailable(status) &&
    !saved(status)
  )
    approvalStatus = { ...reviewSignal, label: `${reviewSignal.label} · details not loaded` }

  const metrics: PullReadinessMetric[] = [
    {
      id: 'checks',
      title: 'Checks',
      signal: checkStatus ?? {
        label: checkLabel || 'No check reports',
        tone: checkCounts.has('danger')
          ? 'danger'
          : checkCounts.has('warning')
            ? 'warning'
            : checkCounts.has('positive')
              ? 'positive'
              : 'neutral',
      },
      segments: checkStatus ? [] : checkSegments,
      description:
        'Reported checks for this commit. Skipped and unknown results do not count as passed.',
    },
    {
      id: 'comments',
      title: 'Comments',
      signal: commentStatus ?? {
        label: commentLabel,
        tone: unresolved ? 'warning' : resolved && !unknown ? 'positive' : 'neutral',
      },
      segments: commentStatus
        ? []
        : segments([
            ['positive', resolved],
            ['warning', unresolved],
            ['neutral', unknown],
          ]),
      description: discussion.ready
        ? `${plural(comments.filter((comment) => comment.kind === 'comment').length, 'discussion comment')}. Review thread resolution is shown only when the provider reports it.`
        : 'Open activity to load discussion and code comments.',
    },
    {
      id: 'approvals',
      title: 'Approvals',
      signal: approvalStatus ?? {
        label: approvalLabel
          ? `${approvalLabel}${detail.pull.reviewDecision === 'REVIEW_REQUIRED' && !waiting.size ? ' · required review pending' : detail.pull.reviewDecision === 'CHANGES_REQUESTED' && !changes ? ' · changes requested' : ''}`
          : reviewSignal.label,
        tone: reviewSignal.tone,
      },
      segments:
        approvalStatus ||
        (detail.pull.reviewDecision === 'REVIEW_REQUIRED' && !waiting.size && !changes)
          ? []
          : segments([
              ['positive', approved],
              ['danger', changes],
              ['neutral', waiting.size],
            ]),
      description:
        'Latest submitted decisions and requested reviewers. The server determines the required approvals.',
    },
  ]
  for (const metric of metrics) {
    const resource = metric.id === 'checks' ? checks : discussion
    if (resource.ready && saved(resource) && !unavailable(resource)) {
      metric.signal = { label: `${metric.signal.label} · saved`, tone: 'neutral' }
      metric.segments = metric.segments.map((segment) => ({ ...segment, tone: 'neutral' }))
    }
  }
  return {
    headline,
    description:
      description +
      (detail.pull.autoMergeEnabled && detail.pull.state === 'open' ? ' Auto-merge enabled.' : ''),
    metrics,
  }
}
export type PullReadiness = ReturnType<typeof pullReadiness>
