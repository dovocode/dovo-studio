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
  Volume2,
  VolumeX,
  Camera,
  Mic,
  ScreenShare,
} from 'lucide-react'
import { cn, ContextMenu, IconButton } from '@dovo/studio-ui'
import { RuntimeIcon } from '@dovo/studio-ui/runtime-icon'
import { useWorkspace } from '@dovo/studio-core'
import {
  browserTabBadge,
  browserTabCategory,
  browserTabKeepsAwake,
  runtimeComputerName,
  type BrowserTabState,
} from '@dovo/protocol'
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
  state,
  onMute,
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
  state?: BrowserTabState
  onMute?: () => void
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
  const title = state?.title || tab.title || tab.url.replace(/^https?:\/\//, '') || 'New tab'
  const badge = state?.badge ?? browserTabBadge(title)
  const category = browserTabCategory(tab)
  const keepsAwake = category === 'active' && tab.kind === 'web' && browserTabKeepsAwake(tab)
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
          data-active={active || undefined}
          data-pinned={tab.pinned || undefined}
          draggable={!!reorder}
          onDragStart={reorder?.onDragStart}
          onDragOver={reorder?.onDragOver}
          onDrop={reorder?.onDrop}
          onDragEnd={reorder?.onDragEnd}
          className={cn(
            'studio-browser-tab group relative flex min-w-0 items-center rounded-lg transition-colors',
            tab.pinned && 'flex-col',
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
            className={`studio-browser-tab-select flex min-w-0 items-center gap-2 text-left ${tab.pinned ? 'h-12 w-full flex-none justify-center px-2 py-2' : 'h-10 flex-1 px-2 text-xs'}`}
          >
            <span className="studio-browser-tab-source flex shrink-0 flex-col items-center gap-1">
              <span className="studio-browser-tab-favicon relative inline-flex items-center">
                <BrowserFavicon tab={tab} />
                {badge !== undefined && (
                  <span
                    aria-label={badge === 'unread' ? 'Unread activity' : `${badge} unread`}
                    className={cn(
                      'studio-browser-tab-badge absolute -right-2 -top-2 rounded-full bg-primary text-primary-foreground ring-2 ring-sidebar',
                      badge === 'unread'
                        ? 'size-2'
                        : 'min-w-3.5 px-1 text-center text-[9px] font-semibold leading-3.5',
                    )}
                  >
                    {badge === 'unread' ? null : badge > 99 ? '99+' : badge}
                  </span>
                )}
                {keepsAwake && (
                  <span
                    aria-label="Kept awake"
                    title="Keep awake is on"
                    className="absolute -right-1 -bottom-1 size-1.5 rounded-full bg-status-success ring-2 ring-sidebar"
                  />
                )}
              </span>
              <span
                className="studio-browser-tab-profile flex h-2.5 shrink-0 items-center justify-center gap-0.5 text-[8px] leading-none text-muted-foreground"
                aria-label={`${computer} · ${profile}`}
              >
                <RuntimeIcon
                  icon={tab.kind === 'remote' ? owner?.snapshot?.runtimeIcon : undefined}
                  className="size-2 shrink-0"
                  aria-hidden="true"
                />
                <span
                  className={cn('max-w-5 truncate', emoji && 'text-[9px]')}
                  title={`${profile} · ${computer}`}
                >
                  {emoji ?? initials}
                </span>
              </span>
            </span>
            {!tab.pinned && (
              <span className="studio-browser-tab-title min-w-0 flex-1 truncate">{title}</span>
            )}
          </button>
          {(state?.camera ||
            state?.microphone ||
            state?.screenSharing ||
            state?.audible ||
            state?.muted) && (
            <div
              aria-label="Tab activity"
              className={cn(
                'studio-browser-tab-activity flex shrink-0 items-center justify-center text-status-success',
                tab.pinned ? 'gap-0.5 px-0.5 pb-1.5' : 'gap-1 pr-1',
              )}
            >
              {state.camera && (
                <span role="img" aria-label={`Camera on in ${title}`} title="Camera on">
                  <Camera className={tab.pinned ? 'size-2.5' : 'size-3'} />
                </span>
              )}
              {state.microphone && (
                <span role="img" aria-label={`Microphone on in ${title}`} title="Microphone on">
                  <Mic className={tab.pinned ? 'size-2.5' : 'size-3'} />
                </span>
              )}
              {state.screenSharing && (
                <span role="img" aria-label={`Screen sharing in ${title}`} title="Screen sharing">
                  <ScreenShare className={tab.pinned ? 'size-2.5' : 'size-3'} />
                </span>
              )}
              {(state.audible || state.muted) && onMute && (
                <IconButton
                  type="button"
                  label={`${state.muted ? 'Unmute' : 'Mute'} tab ${title}`}
                  aria-pressed={state.muted}
                  className="size-5 shrink-0"
                  onClick={onMute}
                >
                  {state.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                </IconButton>
              )}
            </div>
          )}
          {!tab.pinned && (
            <div className="studio-browser-tab-actions flex shrink-0 items-center gap-0.5 rounded opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
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
                className="studio-browser-tab-close size-6"
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
        <ContextMenu.Content className="studio-browser-tab-menu z-50 min-w-48 rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl">
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
              checked={keepsAwake}
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
                    <ContextMenu.SubContent className="studio-browser-tab-menu z-50 min-w-44 rounded-lg border bg-popover p-1 shadow-xl">
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
