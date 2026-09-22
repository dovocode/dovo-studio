import type { PullSummary } from '@dovo/studio-core'
import { useState } from 'react'
import { Badge, ContextMenu } from '@dovo/studio-ui'
import { pullChecks, pullReview, pullState, pullNextStep } from '@dovo/studio-core'
import { GitPullRequest, GitMerge } from 'lucide-react'
import { Signal } from './status'
export function PullRow({
  pull,
  repository,
  selected,
  onSelect,
  compact = false,
}: {
  pull: PullSummary
  compact?: boolean
  repository: string
  selected: boolean
  onSelect: () => void
}) {
  const [error, setError] = useState('')
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
  return (
    <div>
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
            onClick={onSelect}
            className={`group block w-full rounded-lg border px-3 py-3 text-left transition-colors hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-primary ${selected ? 'border-primary/50 bg-accent' : 'border-transparent bg-transparent'}`}
          >
            <div className={`flex gap-3 ${compact ? '' : 'items-center'}`}>
              {pull.state === 'merged' ? (
                <GitMerge aria-hidden className="mt-0.5 size-4 shrink-0 text-violet-400" />
              ) : (
                <GitPullRequest
                  aria-hidden
                  className={`mt-0.5 size-4 shrink-0 ${pull.state === 'open' && !pull.draft ? 'text-emerald-400' : 'text-muted-foreground'}`}
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="truncate">{repository}</span>
                  <span className="shrink-0">#{pull.number}</span>
                  <Badge variant="outline" className="ml-auto text-[10px]">
                    {pullState(pull).label}
                  </Badge>
                </div>
                <p className={`mt-1 font-medium ${compact ? 'line-clamp-2 text-sm' : 'text-sm'}`}>
                  {pull.title}
                </p>
                <p
                  className="mt-1 truncate text-[11px] text-muted-foreground"
                  title={`${pull.head} → ${pull.base}`}
                >
                  {pull.author} ·{' '}
                  <span className="font-mono">
                    {pull.head} → {pull.base}
                  </span>
                </p>
                {pull.state === 'open' && (
                  <div className="mt-2">
                    <Signal signal={pullNextStep(pull)} />
                  </div>
                )}
                {compact && (
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                    <Signal signal={pullChecks(pull)} />
                    <Signal signal={pullReview(pull)} />
                  </div>
                )}
              </div>
              {!compact && (
                <div className="hidden w-44 shrink-0 space-y-1.5 lg:block">
                  <Signal signal={pullChecks(pull)} />
                  <br />
                  <Signal signal={pullReview(pull)} />
                </div>
              )}
              {!compact && (
                <time
                  className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground sm:block"
                  dateTime={pull.updatedAt}
                  title={new Date(pull.updatedAt).toLocaleString()}
                >
                  {new Date(pull.updatedAt).toLocaleDateString()}
                </time>
              )}
            </div>
            {!compact && (
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 pl-7 lg:hidden">
                <Signal signal={pullChecks(pull)} />
                <Signal signal={pullReview(pull)} />
              </div>
            )}
            {!!pull.statusError && (
              <p className="mt-2 text-[10px] text-amber-400" title={pull.statusError}>
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
            <ContextMenu.Label className="px-2 py-1.5 text-[10px] text-muted-foreground">
              {repository} · #{pull.number}
            </ContextMenu.Label>
            <ContextMenu.Item className={menuItem} onSelect={onSelect}>
              Open PR details
            </ContextMenu.Item>
            <ContextMenu.Item className={menuItem} asChild>
              <a href={pull.url} target="_blank" rel="noreferrer">
                Open in browser
              </a>
            </ContextMenu.Item>
            <ContextMenu.Separator className="my-1 h-px bg-border" />
            <ContextMenu.Item className={menuItem} onSelect={() => void copy(pull.url)}>
              Copy PR link
            </ContextMenu.Item>
            <ContextMenu.Item className={menuItem} onSelect={() => void copy(`#${pull.number}`)}>
              Copy PR number
            </ContextMenu.Item>
            <ContextMenu.Item className={menuItem} onSelect={() => void copy(pull.title)}>
              Copy title
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      {error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
