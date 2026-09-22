import type { PullComment, PullDetail, PullSummary } from './pulls.js'
export type PullTone = 'neutral' | 'positive' | 'warning' | 'danger' | 'accent'
export type PullSignal = { label: string; tone: PullTone }
export function pullCommentSignal(
  comment: Pick<PullComment, 'kind' | 'state' | 'replyTo'>,
): PullSignal {
  if (comment.kind === 'comment') return { label: 'Discussion', tone: 'neutral' }
  if (comment.kind === 'inline')
    return { label: comment.replyTo ? 'Code reply' : 'Code comment', tone: 'neutral' }
  switch (comment.state) {
    case 'APPROVED':
      return { label: 'Approved', tone: 'positive' }
    case 'APPROVED_WITH_SUGGESTIONS':
      return { label: 'Approved with suggestions', tone: 'positive' }
    case 'WAITING_FOR_AUTHOR':
      return { label: 'Waiting for author', tone: 'warning' }
    case 'CHANGES_REQUESTED':
      return { label: 'Changes requested', tone: 'danger' }
    case 'COMMENTED':
      return { label: 'Review comment', tone: 'neutral' }
    case 'DISMISSED':
      return { label: 'Review dismissed', tone: 'neutral' }
    case 'PENDING':
      return { label: 'Pending review', tone: 'warning' }
    default:
      return { label: 'Review', tone: 'neutral' }
  }
}
export function pullState(pull: Pick<PullSummary, 'state' | 'draft'>): PullSignal {
  if (pull.state === 'merged') return { label: 'Merged', tone: 'accent' }
  if (pull.state === 'closed') return { label: 'Closed', tone: 'neutral' }
  return pull.draft ? { label: 'Draft', tone: 'neutral' } : { label: 'Open', tone: 'positive' }
}
export function pullChecks(pull: PullSummary): PullSignal {
  if (pull.statusError) return { label: 'Checks unavailable', tone: 'warning' }
  if (pull.checksState === undefined) return { label: 'Checks not loaded', tone: 'neutral' }
  if (pull.checksState === null) return { label: 'No checks', tone: 'neutral' }
  if (pull.checksState === 'SUCCESS') return { label: 'Checks passed', tone: 'positive' }
  if (['FAILURE', 'ERROR'].includes(pull.checksState))
    return { label: 'Checks failed', tone: 'danger' }
  if (['PENDING', 'EXPECTED'].includes(pull.checksState))
    return { label: 'Checks pending', tone: 'warning' }
  return {
    label: `Checks: ${pull.checksState.toLowerCase().replaceAll('_', ' ')}`,
    tone: 'neutral',
  }
}
export function pullReview(pull: PullSummary): PullSignal {
  if (pull.statusError) return { label: 'Review status unavailable', tone: 'warning' }
  switch (pull.reviewDecision) {
    case 'APPROVED_WITH_SUGGESTIONS':
      return { label: 'Approved with suggestions', tone: 'positive' }
    case 'WAITING_FOR_AUTHOR':
      return { label: 'Waiting for author', tone: 'warning' }
    case 'APPROVED':
      return { label: 'Approved', tone: 'positive' }
    case 'CHANGES_REQUESTED':
      return { label: 'Changes requested', tone: 'danger' }
    case 'REVIEW_REQUIRED':
      return { label: 'Review required', tone: 'warning' }
    default:
      return { label: 'No review decision', tone: 'neutral' }
  }
}
export function pullNextStep(pull: PullSummary): PullSignal {
  if (pull.state !== 'open') return pullState(pull)
  if (pull.statusError) return { label: 'Refresh unavailable status', tone: 'warning' }
  if (pull.draft) return { label: 'Draft · work in progress', tone: 'neutral' }
  if (pull.viewerReviewRequested) return { label: 'Your review requested', tone: 'accent' }
  if (pull.reviewDecision === 'CHANGES_REQUESTED')
    return {
      label: pull.viewerIsAuthor ? 'Address requested changes' : 'Author addressing feedback',
      tone: pull.viewerIsAuthor === false ? 'neutral' : 'danger',
    }
  if (pull.reviewDecision === 'WAITING_FOR_AUTHOR')
    return {
      label: pull.viewerIsAuthor ? 'Respond to review feedback' : 'Waiting for author',
      tone: pull.viewerIsAuthor ? 'warning' : 'neutral',
    }
  if (['FAILURE', 'ERROR'].includes(pull.checksState ?? ''))
    return {
      label: pull.viewerIsAuthor ? 'Fix failing checks' : 'Inspect failing checks',
      tone: 'danger',
    }
  if (['PENDING', 'EXPECTED'].includes(pull.checksState ?? ''))
    return { label: 'Waiting for checks', tone: 'neutral' }
  if (pull.reviewDecision === 'REVIEW_REQUIRED')
    return { label: 'Waiting for review', tone: 'neutral' }
  if (
    ['APPROVED', 'APPROVED_WITH_SUGGESTIONS'].includes(pull.reviewDecision ?? '') &&
    pull.checksState === 'SUCCESS'
  )
    return { label: 'Review merge readiness', tone: 'positive' }
  return { label: 'Open details to review', tone: 'neutral' }
}
function pullPriority(pull: PullSummary) {
  if (pull.state !== 'open') return 7
  if (pull.draft) return 6
  if (pull.statusError) return 4
  if (pull.viewerReviewRequested) return 0
  if (pull.viewerIsAuthor && pull.reviewDecision === 'WAITING_FOR_AUTHOR') return 1
  const blocked =
    ['FAILURE', 'ERROR'].includes(pull.checksState ?? '') ||
    pull.reviewDecision === 'CHANGES_REQUESTED'
  if (blocked) return pull.viewerIsAuthor ? 1 : 2
  if (
    pull.viewerIsAuthor &&
    ['APPROVED', 'APPROVED_WITH_SUGGESTIONS'].includes(pull.reviewDecision ?? '') &&
    pull.checksState === 'SUCCESS'
  )
    return 3
  return 5
}
export function pullNeedsAttention(pull: PullSummary) {
  return pullPriority(pull) < 4
}
export function comparePulls(a: PullSummary, b: PullSummary, attention = true) {
  return (
    (attention ? pullPriority(a) - pullPriority(b) : 0) ||
    b.updatedAt.localeCompare(a.updatedAt) ||
    b.number - a.number ||
    a.url.localeCompare(b.url)
  )
}
export function matchesPull(pull: PullSummary, repository: string, query: string) {
  const text =
    `${repository} #${pull.number} ${pull.title} ${pull.author} ${pull.head} ${pull.base} ${pull.labels.join(' ')}`.toLowerCase()
  return query
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .every((part) => text.includes(part))
}
export function checkSignal(status: string): PullSignal {
  status = status.toUpperCase()
  const label = status.toLowerCase().replaceAll('_', ' ')
  return {
    label,
    tone: ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STALE'].includes(
      status,
    )
      ? 'danger'
      : ['PENDING', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED', 'EXPECTED'].includes(status)
        ? 'warning'
        : status === 'SUCCESS'
          ? 'positive'
          : 'neutral',
  }
}
export function latestPullReviews(comments: PullComment[]) {
  const reviews = new Map<string, PullComment>()
  for (const comment of comments) {
    if (
      comment.kind !== 'review' ||
      ![
        'APPROVED',
        'APPROVED_WITH_SUGGESTIONS',
        'WAITING_FOR_AUTHOR',
        'CHANGES_REQUESTED',
        'DISMISSED',
      ].includes(comment.state ?? '')
    )
      continue
    const previous = reviews.get(comment.author)
    if (!previous || comment.date >= previous.date) reviews.set(comment.author, comment)
  }
  return [...reviews.values()].sort((a, b) => a.author.localeCompare(b.author))
}
export function pullMergeability(pull: PullDetail['pull']): PullSignal {
  if (pull.state !== 'open')
    return {
      label: pull.state === 'merged' ? 'Already merged' : 'Pull request closed',
      tone: 'neutral',
    }
  if (pull.mergeable === null) return { label: 'Mergeability pending', tone: 'neutral' }
  return pull.mergeable
    ? { label: 'No merge conflicts', tone: 'positive' }
    : { label: 'Merge conflicts', tone: 'danger' }
}
export function pullDetailChecks(detail: PullDetail): PullSignal {
  const failed = detail.checks.filter((check) => checkSignal(check.status).tone === 'danger').length
  const pending = detail.checks.filter(
    (check) => checkSignal(check.status).tone === 'warning',
  ).length
  if (failed)
    return { label: `${failed} failed${pending ? ` · ${pending} pending` : ''}`, tone: 'danger' }
  if (pending)
    return { label: `${pending} check${pending === 1 ? '' : 's'} pending`, tone: 'warning' }
  const passed = detail.checks.filter(
    (check) => checkSignal(check.status).tone === 'positive',
  ).length
  return passed
    ? { label: `${passed} check${passed === 1 ? '' : 's'} passed`, tone: 'positive' }
    : {
        label: detail.checks.length
          ? `${detail.checks.length} check${detail.checks.length === 1 ? '' : 's'} reported`
          : 'No checks returned',
        tone: 'neutral',
      }
}
export function pullDetailReviews(detail: PullDetail): PullSignal {
  const reviews = latestPullReviews(detail.comments)
  if (reviews.some((review) => review.state === 'CHANGES_REQUESTED'))
    return { label: 'Changes requested', tone: 'danger' }
  if (reviews.some((review) => review.state === 'WAITING_FOR_AUTHOR'))
    return { label: 'Waiting for author', tone: 'warning' }
  const approved = reviews.filter(
    (review) => review.state === 'APPROVED' || review.state === 'APPROVED_WITH_SUGGESTIONS',
  ).length
  return approved
    ? { label: `${approved} approval${approved === 1 ? '' : 's'}`, tone: 'positive' }
    : {
        label: detail.pull.reviewers.length ? 'Awaiting review' : 'No review decision',
        tone: 'neutral',
      }
}
