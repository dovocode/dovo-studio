import {
  Home,
  Pencil,
  Archive,
  X,
  Pin,
  PinOff,
  AlarmClock,
  ExternalLink,
  ArrowUpRight,
} from 'lucide-react'
import { cn, ContextMenu, IconButton } from '@dovo/studio-ui'
import { RuntimeIcon } from '@dovo/studio-ui/runtime-icon'
import { useWorkspace } from '@dovo/studio-core'
import { browserTabCategory, runtimeComputerName } from '@dovo/protocol'
import { BrowserFavicon } from './browser-favicon'
import { useBrowserProfileDetails } from './browser-profile-label'
import type { DragEventHandler } from 'react'
import type { BrowserTab } from './shared-browser-tabs'

export function BrowserTabRow({
  tab,
  active,
  busy,
  windows,
  onSelect,
  onPin,
  onHome,
  onEditHome,
  onSettle,
  onSnooze,
  onClose,
  onMove,
  onMenuOpen,
  onKeepAwake,
  reorder,
}: {
  tab: BrowserTab
  active: boolean
  busy: boolean
  windows: { id: number; title: string }[]
  onSelect: () => void
  onPin: () => void
  onHome?: () => void
  onEditHome?: () => void
  onSettle: () => void
  onSnooze: () => void
  onClose: () => void
  onMove?: (windowId?: number) => void
  onMenuOpen: () => void
  onKeepAwake?: () => void
  reorder?: {
    dragging: boolean
    edge?: 'before' | 'after'
    onDragStart: DragEventHandler<HTMLDivElement>
    onDragOver: DragEventHandler<HTMLDivElement>
    onDrop: DragEventHandler<HTMLDivElement>
    onDragEnd: DragEventHandler<HTMLDivElement>
    onMove: (direction: 'previous' | 'next') => void
  }
}) {
  const { runtimes } = useWorkspace()
  const { name: profile, emoji } = useBrowserProfileDetails(tab)
  const words = profile.trim().split(/\s+/)
  const initials = (
    words.length > 1
      ? words
          .slice(0, 2)
          .map((word) => word[0])
          .join('')
      : profile.slice(0, 2)
  ).toUpperCase()
  const owner = runtimes.find((entry) => entry.profile.id === tab.runtimeId)
  const computer =
    tab.kind === 'web'
      ? 'This computer'
      : owner
        ? runtimeComputerName(owner)
        : 'Unavailable computer'
  const title = tab.title || tab.url.replace(/^https?:\/\//, '') || 'New tab'
  const category = browserTabCategory(tab)
  const menuItem =
    'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs outline-none focus:bg-accent data-[disabled]:opacity-50'
  return (
    <ContextMenu.Root
      onOpenChange={(open) => {
        if (open) onMenuOpen()
      }}
    >
      <ContextMenu.Trigger asChild>
        <div
          data-browser-tab-id={tab.id}
          draggable={!!reorder}
          onDragStart={reorder?.onDragStart}
          onDragOver={reorder?.onDragOver}
          onDrop={reorder?.onDrop}
          onDragEnd={reorder?.onDragEnd}
          className={cn(
            'group relative flex min-w-0 items-center rounded-lg transition-colors',
            reorder?.dragging && 'opacity-40',
            reorder?.edge &&
              (tab.pinned
                ? reorder.edge === 'before'
                  ? 'before:pointer-events-none before:absolute before:inset-y-1 before:left-0 before:border-l-2 before:border-primary'
                  : 'after:pointer-events-none after:absolute after:inset-y-1 after:right-0 after:border-r-2 after:border-primary'
                : reorder.edge === 'before'
                  ? 'before:pointer-events-none before:absolute before:inset-x-1 before:top-0 before:border-t-2 before:border-primary'
                  : 'after:pointer-events-none after:absolute after:inset-x-1 after:bottom-0 after:border-b-2 after:border-primary'),

            tab.pinned
              ? cn(
                  'overflow-hidden rounded-xl border',
                  active
                    ? 'border-primary/30 bg-accent text-foreground shadow-sm'
                    : 'border-border/50 bg-background/50 text-muted-foreground hover:border-border hover:bg-accent/40 hover:text-foreground',
                )
              : active
                ? 'bg-accent/70 text-foreground'
                : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
          )}
        >
          <button
            type="button"
            data-browser-tab-select
            aria-keyshortcuts={
              reorder ? 'Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight' : undefined
            }
            onKeyDown={(event) => {
              if (
                !reorder ||
                !event.altKey ||
                event.ctrlKey ||
                event.metaKey ||
                !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)
              )
                return
              event.preventDefault()
              reorder.onMove(
                event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? 'previous' : 'next',
              )
            }}
            aria-current={active ? 'page' : undefined}
            aria-label={`${title} ${tab.kind === 'web' ? 'Local' : 'Remote'} · ${computer} · ${profile}`}
            onClick={onSelect}
            title={`${title}\n${tab.url}\n${computer} · ${profile}${tab.snoozedUntil && category === 'snoozed' ? `\nWakes ${new Date(tab.snoozedUntil).toLocaleString()}` : ''}`}
            className={`flex min-w-0 flex-1 items-center gap-2 text-left ${tab.pinned ? 'h-16 flex-col justify-center gap-1.5 px-2 text-[11px]' : 'h-9 px-2 text-xs'}`}
          >
            <span className="relative inline-flex shrink-0 items-center">
              <BrowserFavicon tab={tab} />
              {tab.keepAwake && (
                <span
                  aria-label="Kept awake"
                  title="Keep awake is on"
                  className="absolute -right-1 -bottom-1 size-1.5 rounded-full bg-status-success ring-2 ring-sidebar"
                />
              )}
            </span>
            <span
              className={
                tab.pinned
                  ? 'line-clamp-2 min-h-[2.5em] w-full text-center leading-tight break-words'
                  : 'min-w-0 flex-1 truncate'
              }
            >
              {title}
            </span>
            <span
              className={
                tab.pinned
                  ? 'absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded bg-background/80 px-0.5 text-[9px] leading-none text-muted-foreground'
                  : 'flex shrink-0 items-center gap-0.5 text-[9px] leading-none text-muted-foreground'
              }
              aria-label={`${computer} · ${profile}`}
            >
              {!tab.pinned && (
                <RuntimeIcon
                  icon={tab.kind === 'remote' ? owner?.snapshot?.runtimeIcon : undefined}
                  className="size-2.5 shrink-0"
                  aria-hidden="true"
                />
              )}
              <span
                className={cn('max-w-6 truncate', emoji && 'text-xs')}
                title={`${profile} · ${computer}`}
              >
                {emoji ?? initials}
              </span>
            </span>
          </button>
          {!tab.pinned && (
            <div className="absolute right-0.5 flex items-center gap-0.5 rounded bg-sidebar opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:static [@media(hover:none)]:opacity-100">
              {category === 'active' && (
                <IconButton
                  type="button"
                  label={`Settle tab ${title}`}
                  className="size-6"
                  disabled={busy}
                  onClick={onSettle}
                >
                  <Archive size={12} />
                </IconButton>
              )}
              <IconButton
                type="button"
                label={`Close tab ${title}`}
                className="size-6"
                disabled={busy}
                onClick={onClose}
              >
                <X size={12} />
              </IconButton>
            </div>
          )}
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 min-w-48 rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl">
          <ContextMenu.Label className="max-w-64 truncate px-2 py-1.5 text-xs text-muted-foreground">
            {title}
          </ContextMenu.Label>
          <ContextMenu.Item className={menuItem} disabled={busy} onSelect={onPin}>
            {tab.pinned ? <PinOff size={13} /> : <Pin size={13} />}
            {tab.pinned ? 'Unpin tab' : 'Pin tab'}
          </ContextMenu.Item>
          {tab.pinned && (
            <>
              {onHome && (
                <ContextMenu.Item className={menuItem} disabled={busy} onSelect={onHome}>
                  <Home size={13} /> Return to home
                </ContextMenu.Item>
              )}
              {onEditHome && (
                <ContextMenu.Item className={menuItem} disabled={busy} onSelect={onEditHome}>
                  <Pencil size={13} /> Edit home URL
                </ContextMenu.Item>
              )}
            </>
          )}
          {onKeepAwake && (
            <ContextMenu.CheckboxItem
              className={menuItem}
              checked={!!tab.keepAwake}
              disabled={busy}
              onCheckedChange={onKeepAwake}
            >
              Keep awake
            </ContextMenu.CheckboxItem>
          )}
          {category !== 'active' && (
            <ContextMenu.Item className={menuItem} disabled={busy} onSelect={onSelect}>
              <ArrowUpRight size={13} />
              Wake tab
            </ContextMenu.Item>
          )}
          <ContextMenu.Item
            className={menuItem}
            disabled={busy || tab.pinned || category === 'settled'}
            onSelect={onSettle}
          >
            <Archive size={13} />
            Settle tab
          </ContextMenu.Item>
          <ContextMenu.Item className={menuItem} disabled={busy || tab.pinned} onSelect={onSnooze}>
            <AlarmClock size={13} />
            Snooze until tomorrow
          </ContextMenu.Item>
          {onMove && (
            <>
              <ContextMenu.Separator className="my-1 h-px bg-border" />
              <ContextMenu.Item className={menuItem} disabled={busy} onSelect={() => onMove()}>
                <ExternalLink size={13} />
                Move to new window
              </ContextMenu.Item>
              {windows.length > 0 && (
                <ContextMenu.Sub>
                  <ContextMenu.SubTrigger className={menuItem}>
                    Move to another window
                    <ArrowUpRight size={13} className="ml-auto" />
                  </ContextMenu.SubTrigger>
                  <ContextMenu.Portal>
                    <ContextMenu.SubContent className="z-50 min-w-44 rounded-lg border bg-popover p-1 shadow-xl">
                      {windows.map((window) => (
                        <ContextMenu.Item
                          key={window.id}
                          className={menuItem}
                          disabled={busy}
                          onSelect={() => onMove(window.id)}
                        >
                          {window.title}
                        </ContextMenu.Item>
                      ))}
                    </ContextMenu.SubContent>
                  </ContextMenu.Portal>
                </ContextMenu.Sub>
              )}
            </>
          )}
          <ContextMenu.Separator className="my-1 h-px bg-border" />
          <ContextMenu.Item className={menuItem} disabled={busy || tab.pinned} onSelect={onClose}>
            <X size={13} />
            Close tab
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}
