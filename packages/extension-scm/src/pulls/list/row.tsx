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
import { AuthorAvatar } from '../author-avatar'
export function PullRow({
  pull,
  repository,
  selected,
  onSelect,
  compact = false,
  statusColumn,
  onClick,
  onAddToThread,
  selectionCount = 1,
}: {
  pull: PullSummary
  compact?: boolean
  statusColumn: boolean
  repository: string
  selected: boolean
  onSelect: () => void
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void
  onAddToThread?: () => void
  selectionCount?: number
}) {
  const [error, setError] = useApplicationState('')
  const hasStatus =
    pull.checksState !== undefined || pull.reviewDecision !== undefined || !!pull.statusError
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
      ? 'text-status-done'
      : pull.state === 'closed'
        ? 'text-status-error'
        : pull.draft
          ? 'text-muted-foreground'
          : 'text-status-success'
  return (
    <div className="relative">
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
                <div
                  className={`grid min-w-0 flex-1 gap-x-3 ${compact ? '' : statusColumn ? '@4xl/pr-list:grid-cols-[minmax(0,1fr)_11rem_5.5rem]' : '@4xl/pr-list:grid-cols-[minmax(0,1fr)_5.5rem]'}`}
                >
                  <div className="min-w-0">
                    <div className="mb-1 flex min-w-0 items-center gap-2 text-[0.6875rem] text-muted-foreground">
                      <span
                        className={`inline-flex shrink-0 items-center gap-1.5 font-medium ${stateColor}`}
                      >
                        <Icon aria-hidden className="size-3.5" />
                        {pullState(pull).label}
                      </span>
                      <span className="min-w-0 flex-1 truncate" title={repository}>
                        {repository}
                      </span>
                      <span className="shrink-0">#{pull.number}</span>
                    </div>
                    <p
                      className="line-clamp-2 break-words text-sm font-medium leading-5 [overflow-wrap:anywhere]"
                      title={pull.title}
                    >
                      {pull.title}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.6875rem] text-muted-foreground">
                      <span
                        className="inline-flex min-w-0 items-center gap-1.5"
                        title={pull.author}
                      >
                        <AuthorAvatar author={pull.author} url={pull.authorAvatarUrl} />
                        <span className="max-w-32 truncate">{pull.author}</span>
                      </span>
                      <span
                        className="min-w-0 max-w-full truncate"
                        title={`${pull.head} → ${pull.base}`}
                      >
                        {pull.head} → {pull.base}
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
                          className="inline-flex flex-wrap items-center gap-1.5 rounded-md border border-status-done/20 bg-status-done/5 px-2 py-1 text-status-done"
                          title={
                            pull.stack.nativeId
                              ? 'Native GitHub stack'
                              : pull.stack.complete
                                ? 'Stack inferred from branch dependencies'
                                : 'Partial stack inferred from this page; open details for the full stack'
                          }
                        >
                          <Layers className="size-3" aria-hidden />
                          <span>
                            {pullStackLabel(pull.stack)}
                            {pull.stack.nativeNumber
                              ? ` · Stack #${pull.stack.nativeNumber}`
                              : pull.stack.rootNumber
                                ? ` · #${pull.stack.rootNumber}`
                                : ''}
                          </span>
                          <span className="font-mono">
                            {pull.stack.parentNumber
                              ? `#${pull.stack.parentNumber} → #${pull.number}`
                              : pull.stack.position === 1
                                ? 'Base PR'
                                : pull.stack.baseRef
                                  ? `onto ${pull.stack.baseRef}`
                                  : ''}
                          </span>
                        </span>
                      )}
                      {pull.state === 'open' && !pull.draft && pull.viewerReviewRequested && (
                        <span className="text-status-done">Your review requested</span>
                      )}
                      <span className="inline-flex items-center gap-2 font-mono tabular-nums">
                        {pull.additions != null && (
                          <span
                            className="text-status-success"
                            aria-label={`${pull.additions} lines added`}
                          >
                            +{pull.additions.toLocaleString()}
                          </span>
                        )}
                        {pull.deletions != null && (
                          <span
                            className="text-status-error"
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
                    className={`${hasStatus ? 'mt-2 flex' : 'hidden'} flex-wrap gap-x-3 gap-y-1 ${compact || !statusColumn ? '' : '@4xl/pr-list:mt-0 @4xl/pr-list:flex @4xl/pr-list:flex-col @4xl/pr-list:justify-center'}`}
                    title={hasStatus ? pullNextStep(pull).label : undefined}
                  >
                    {(pull.checksState !== undefined || pull.statusError) && (
                      <Signal signal={pullChecks(pull)} />
                    )}
                    {(pull.reviewDecision !== undefined || pull.statusError) && (
                      <Signal signal={pullReview(pull)} />
                    )}
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
                <p className="mt-2 text-[0.625rem] text-status-warning" title={pull.statusError}>
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
