import { Archive, X, Pin, PinOff, AlarmClock, ExternalLink, ArrowUpRight } from 'lucide-react'
import { ContextMenu, IconButton } from '@dovo/studio-ui'
import { RuntimeIcon } from '@dovo/studio-ui/runtime-icon'
import { useWorkspace } from '@dovo/studio-core'
import { browserTabCategory, runtimeComputerName } from '@dovo/protocol'
import { BrowserFavicon } from './browser-favicon'
import { useBrowserProfileName } from './browser-profile-label'
import type { BrowserTab } from './shared-browser-tabs'

export function BrowserTabRow({
  tab,
  active,
  busy,
  windows,
  onSelect,
  onPin,
  onSettle,
  onSnooze,
  onClose,
  onMove,
  onMenuOpen,
  onKeepAwake,
}: {
  tab: BrowserTab
  active: boolean
  busy: boolean
  windows: { id: number; title: string }[]
  onSelect: () => void
  onPin: () => void
  onSettle: () => void
  onSnooze: () => void
  onClose: () => void
  onMove?: (windowId?: number) => void
  onMenuOpen: () => void
  onKeepAwake?: () => void
}) {
  const { runtimes } = useWorkspace()
  const profile = useBrowserProfileName(tab)
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
          className={`group relative flex min-w-0 items-center rounded-md ${active ? 'bg-accent/70 text-foreground' : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'}`}
        >
          <button
            type="button"
            aria-current={active ? 'page' : undefined}
            aria-label={`${title} ${tab.kind === 'web' ? 'Local' : 'Remote'} · ${computer} · ${profile}`}
            onClick={onSelect}
            title={`${title}\n${tab.url}\n${computer} · ${profile}${tab.snoozedUntil && category === 'snoozed' ? `\nWakes ${new Date(tab.snoozedUntil).toLocaleString()}` : ''}`}
            className={`flex min-w-0 flex-1 items-center gap-2 text-left ${tab.pinned ? 'justify-center px-1 py-2.5' : 'h-9 px-2 text-xs'}`}
          >
            <BrowserFavicon tab={tab} />
            {tab.keepAwake && (
              <span
                aria-label="Kept awake"
                title="Keep awake is on"
                className="shrink-0 text-status-success"
              >
                ●
              </span>
            )}
            {!tab.pinned && <span className="min-w-0 flex-1 truncate">{title}</span>}
            <span
              className="flex shrink-0 items-center gap-0.5 text-[9px] leading-none text-muted-foreground"
              aria-label={`${computer} · ${profile}`}
            >
              <RuntimeIcon
                icon={tab.kind === 'remote' ? owner?.snapshot?.runtimeIcon : undefined}
                className="size-2.5 shrink-0"
                aria-hidden="true"
              />
              <span className="max-w-6 truncate" title={profile}>
                {profile.slice(0, 2).toUpperCase()}
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
