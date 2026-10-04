import { pullStackLabel } from '@dovo/protocol'
import { useApplicationState } from '@dovo/studio-core/state'
import type { PullSummary } from '@dovo/studio-core'
import { Badge, ContextMenu, DropdownMenu } from '@dovo/studio-ui'
import { pullChecks, pullReview, pullState, pullNextStep, formatDateTime } from '@dovo/studio-core'
import {
  GitPullRequest,
  GitPullRequestDraft,
  GitPullRequestClosed,
  GitMerge,
  Layers,
  MessageSquare,
  MoreHorizontal,
} from 'lucide-react'
import { Signal } from '../detail/status'
export function PullRow({
  pull,
  repository,
  selected,
  onSelect,
  compact = false,
  onClick,
  onAddToThread,
  selectionCount = 1,
}: {
  pull: PullSummary
  compact?: boolean
  repository: string
  selected: boolean
  onSelect: () => void
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void
  onAddToThread?: () => void
  selectionCount?: number
}) {
  const [error, setError] = useApplicationState('')
  const copy = async (text: string) => {
    setError('')
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      setError('Could not copy to clipboard. Try again or open the PR in your browser.')
    }
  }
  const menuItem =
    'cursor-default rounded-sm px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground'
  const menu = (Menu: typeof ContextMenu | typeof DropdownMenu) => (
    <>
      <Menu.Label className="px-2 py-1.5 text-[0.625rem] text-muted-foreground">
        {repository} · #{pull.number}
      </Menu.Label>
      <Menu.Item className={menuItem} onSelect={onSelect}>
        Open PR details
      </Menu.Item>
      {onAddToThread && (
        <Menu.Item className={menuItem} onSelect={onAddToThread}>
          Add to thread{selectionCount > 1 ? ` (${selectionCount} PRs)` : ''}
        </Menu.Item>
      )}
      <Menu.Item className={menuItem} asChild>
        <a data-dovo-external="true" href={pull.url} target="_blank" rel="noreferrer">
          Open in browser
        </a>
      </Menu.Item>
      <Menu.Separator className="my-1 h-px bg-border" />
      <Menu.Item className={menuItem} onSelect={() => void copy(pull.url)}>
        Copy PR link
      </Menu.Item>
      <Menu.Item className={menuItem} onSelect={() => void copy(`#${pull.number}`)}>
        Copy PR number
      </Menu.Item>
      <Menu.Item className={menuItem} onSelect={() => void copy(pull.title)}>
        Copy title
      </Menu.Item>
    </>
  )
  const Icon =
    pull.state === 'merged'
      ? GitMerge
      : pull.state === 'closed'
        ? GitPullRequestClosed
        : pull.draft
          ? GitPullRequestDraft
          : GitPullRequest
  const stateColor =
    pull.state === 'merged'
      ? 'text-violet-400'
      : pull.state === 'closed'
        ? 'text-red-400'
        : pull.draft
          ? 'text-muted-foreground'
          : 'text-emerald-400'
  return (
    <div>
      <div
        className={`group flex min-w-0 items-center rounded-md border transition-colors ${selected ? 'border-primary/50 bg-accent' : 'border-transparent hover:bg-accent/60'}`}
      >
        <ContextMenu.Root>
          <ContextMenu.Trigger asChild>
            <button
              type="button"
              onKeyDown={(event) => {
                if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                  event.preventDefault()
                  const rect = event.currentTarget.getBoundingClientRect()
                  event.currentTarget.dispatchEvent(
                    new MouseEvent('contextmenu', {
                      bubbles: true,
                      clientX: rect.left + 16,
                      clientY: rect.top + 16,
                    }),
                  )
                }
              }}
              aria-current={selected ? 'true' : undefined}
              onClick={onClick ?? onSelect}
              className="min-w-0 flex-1 rounded-md px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-primary"
            >
              <div className="flex gap-3">
                <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${stateColor}`} />
                <span className="sr-only">{pullState(pull).label}</span>
                <div
                  className={`grid min-w-0 flex-1 gap-x-3 ${compact ? '' : '@4xl/pr-list:grid-cols-[minmax(0,1fr)_11rem_5.5rem]'}`}
                >
                  <div className="min-w-0">
                    <div className="flex items-start gap-2">
                      <p
                        className="min-w-0 flex-1 line-clamp-2 break-words text-sm font-medium leading-5"
                        title={pull.title}
                      >
                        {pull.title}
                      </p>
                      {(pull.draft || pull.state !== 'open') && (
                        <Badge
                          variant="outline"
                          className={`shrink-0 text-[0.625rem] ${stateColor}`}
                        >
                          {pullState(pull).label}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.6875rem] text-muted-foreground">
                      <span>#{pull.number}</span>
                      <span
                        className="max-w-52 truncate"
                        title={`${repository} · ${pull.head} → ${pull.base}`}
                      >
                        {repository}
                      </span>
                      <span className="max-w-32 truncate" title={pull.author}>
                        {pull.author}
                      </span>
                      <time
                        className={compact ? '' : '@4xl/pr-list:hidden'}
                        dateTime={pull.updatedAt}
                        title={formatDateTime(pull.updatedAt)}
                      >
                        {formatDateTime(pull.updatedAt, { dateStyle: 'medium' })}
                      </time>
                      {pull.stack && (
                        <span
                          className="inline-flex shrink-0 items-center gap-1 text-violet-400"
                          title={
                            pull.stack.parentNumber
                              ? `Depends on PR #${pull.stack.parentNumber}`
                              : 'Base of this PR stack'
                          }
                        >
                          <Layers className="size-3" aria-hidden />
                          {pullStackLabel(pull.stack)}
                        </span>
                      )}
                      {pull.state === 'open' && !pull.draft && pull.viewerReviewRequested && (
                        <span className="text-violet-400">Your review requested</span>
                      )}
                      <span className="inline-flex items-center gap-2 font-mono tabular-nums">
                        {pull.additions != null && (
                          <span
                            className="text-emerald-400"
                            aria-label={`${pull.additions} lines added`}
                          >
                            +{pull.additions.toLocaleString()}
                          </span>
                        )}
                        {pull.deletions != null && (
                          <span
                            className="text-red-400"
                            aria-label={`${pull.deletions} lines deleted`}
                          >
                            −{pull.deletions.toLocaleString()}
                          </span>
                        )}
                        {pull.commentCount != null && (
                          <span
                            className="inline-flex items-center gap-1 text-muted-foreground"
                            title={`${pull.commentCount} comments`}
                            aria-label={`${pull.commentCount} comments`}
                          >
                            <MessageSquare className="size-3" aria-hidden />
                            {pull.commentCount.toLocaleString()}
                          </span>
                        )}
                      </span>
                      {!compact && !!pull.labels.length && (
                        <span
                          className="inline-flex min-w-0 items-center gap-1"
                          aria-label="Labels"
                        >
                          {pull.labels.slice(0, 2).map((label) => (
                            <Badge
                              key={label}
                              variant="secondary"
                              className="max-w-28 truncate text-[0.625rem]"
                              title={label}
                            >
                              {label}
                            </Badge>
                          ))}
                          {pull.labels.length > 2 && (
                            <span
                              className="text-[0.625rem] text-muted-foreground"
                              title={pull.labels.slice(2).join(', ')}
                            >
                              +{pull.labels.length - 2}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                  <div
                    className={`mt-2 flex flex-wrap gap-x-3 gap-y-1 ${compact ? '' : '@4xl/pr-list:mt-0 @4xl/pr-list:flex-col @4xl/pr-list:justify-center'}`}
                    title={pullNextStep(pull).label}
                  >
                    <Signal signal={pullChecks(pull)} />
                    <Signal signal={pullReview(pull)} />
                  </div>
                  {!compact && (
                    <time
                      className="hidden self-center text-right text-xs text-muted-foreground @4xl/pr-list:block"
                      dateTime={pull.updatedAt}
                      title={formatDateTime(pull.updatedAt)}
                    >
                      {formatDateTime(pull.updatedAt, { dateStyle: 'medium' })}
                    </time>
                  )}
                </div>
              </div>
              {!!pull.statusError && (
                <p className="mt-2 text-[0.625rem] text-amber-400" title={pull.statusError}>
                  Status unavailable · refresh to retry
                </p>
              )}
            </button>
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Content
              className="z-50 min-w-48 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
              collisionPadding={8}
            >
              {menu(ContextMenu)}
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu.Root>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label={`Actions for PR #${pull.number}`}
              className="mr-2 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
            >
              <MoreHorizontal aria-hidden className="size-4" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              collisionPadding={8}
              className="z-50 min-w-48 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
            >
              {menu(DropdownMenu)}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
