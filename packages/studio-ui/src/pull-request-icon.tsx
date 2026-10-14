import { GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from 'lucide-react'
import { cn } from './lib/utils'

export function pullRequestIconTone(state?: string, draft?: boolean) {
  return state === 'merged'
    ? 'text-violet-600 dark:text-violet-400'
    : state === 'closed'
      ? 'text-red-600 dark:text-red-400'
      : draft || state !== 'open'
        ? 'text-muted-foreground'
        : 'text-emerald-600 dark:text-emerald-400'
}

export function PullRequestIcon({
  state,
  draft,
  size = 12,
  className,
}: {
  state?: string
  draft?: boolean
  size?: number
  className?: string
}) {
  const Icon =
    state === 'merged'
      ? GitMerge
      : state === 'closed'
        ? GitPullRequestClosed
        : draft
          ? GitPullRequestDraft
          : GitPullRequest
  return (
    <Icon
      size={size}
      className={cn('shrink-0', pullRequestIconTone(state, draft), className)}
      aria-label={
        draft && state === 'open' ? 'Draft pull request' : `${state ?? 'Linked'} pull request`
      }
    />
  )
}
