import type { ReactNode } from 'react'
import {
  AlarmClock,
  Check,
  GitBranch,
  FolderOpen,
  Globe2,
  MessageSquare,
  Pin,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react'
import type { Task } from '@dovo/studio-core'
import { cn } from '@dovo/studio-ui'
import { RuntimeIcon } from '@dovo/studio-ui/runtime-icon'
import type { RuntimeSnapshot } from '@dovo/protocol'
import { TaskRow } from '../list/task-row'
import type { TaskOwner } from '../list/task-collection'
import { BrowserFavicon } from '../browser/browser-favicon'
import { useBrowserProfileDetails } from '../browser/browser-profile-label'
import type { BrowserTab } from '../browser/shared-browser-tabs'

export type WorkspaceRowStatus = 'active' | 'snoozed' | 'settled'
type RowShell = {
  title: string
  selected: boolean
  disabled: boolean
  status: WorkspaceRowStatus
  onSelect: () => void
  /** The item's Pin / Settle / Snooze menu, kept beside the row. */
  actions: ReactNode
}

/** A small kind mark tucked under a row's primary icon; the row itself names the kind. */
function KindMark({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'pointer-events-none flex size-3.5 items-center justify-center rounded-[4px] bg-sidebar text-muted-foreground ring-1 ring-border',
        className,
      )}
    >
      <Icon className="size-2.5" strokeWidth={2} />
    </span>
  )
}
function LifecycleMark({ status }: { status: WorkspaceRowStatus }) {
  if (status === 'settled')
    return <Check className="size-3.5 shrink-0 text-muted-foreground" aria-label="Settled" />
  if (status === 'snoozed')
    return <AlarmClock className="size-3.5 shrink-0 text-muted-foreground" aria-label="Snoozed" />
  return null
}
/** Every kind shares one outer row so the mixed list keeps one rhythm and one actions slot. */
function RowFrame({
  kind,
  title,
  selected,
  children,
  actions,
  compact = false,
}: {
  kind: 'Thread' | 'Page' | 'Terminal'
  title: string
  selected: boolean
  children: ReactNode
  actions: ReactNode
  compact?: boolean
}) {
  return (
    <div
      role="group"
      aria-label={`${kind}: ${title}`}
      data-workspace-kind={kind.toLowerCase()}
      data-compact={compact || undefined}
      data-highlighted={selected || undefined}
      className="studio-workspace-row group/workspace relative mb-[3px] min-w-0 [&:hover_.studio-thread-card-context:first-child]:pr-28 [&:focus-within_.studio-thread-card-context:first-child]:pr-28 has-[[data-state=open]]:[&_.studio-thread-card-context:first-child]:pr-28 [&:hover_.studio-browser-tab-title]:pr-28 [&:focus-within_.studio-browser-tab-title]:pr-28 has-[[data-state=open]]:[&_.studio-browser-tab-title]:pr-28 [@media(hover:none)]:[&_.studio-thread-card-context:first-child]:pr-28 [@media(hover:none)]:[&_.studio-browser-tab-title]:pr-28"
    >
      <div className={cn('relative min-w-0', compact && '[&_.studio-thread-card-title]:pr-24')}>
        {children}
      </div>
      <div
        data-workspace-actions
        className="absolute right-2 top-0.5 [[data-compact]_&]:top-1.5 pointer-events-none opacity-0 transition-opacity group-hover/workspace:pointer-events-auto group-hover/workspace:opacity-100 group-focus-within/workspace:pointer-events-auto group-focus-within/workspace:opacity-100 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
      >
        {actions}
      </div>
    </div>
  )
}

/**
 * The thread list's own row, unchanged, with a mini message bubble under its project icon.
 * Offsets follow TaskRow's layout: px-2.5/py-2 padding and a size-7 icon (size-4 when settled).
 */
export function WorkspaceThreadRow({
  task,
  owner,
  needsInput,
  terminals,
  title,
  selected,
  disabled,
  onSelect,
  actions,
}: RowShell & {
  task: Task
  owner: TaskOwner
  needsInput: boolean
  terminals: number
}) {
  const compact = task.archived || !!task.archivedAt
  return (
    <RowFrame kind="Thread" title={title} selected={selected} actions={actions} compact={compact}>
      <TaskRow
        task={task}
        owner={owner}
        selected={selected}
        onSelect={onSelect}
        needsInput={needsInput}
        terminals={terminals}
        editable={false}
        disabled={disabled}
      />
      <KindMark
        icon={MessageSquare}
        className={cn(
          'absolute',
          // Settled rows shrink the icon to one line, so the bubble sits at its lower corner.
          compact ? 'left-[20px] top-[18px]' : 'left-[17px] top-[40px]',
        )}
      />
    </RowFrame>
  )
}

/** The browser sidebar's page row (favicon, title, computer and profile initials), plus a mini browser mark. */
export function WorkspacePageRow({
  page,
  computer,
  runtimeIcon,
  title,
  selected,
  disabled,
  status,
  onSelect,
  actions,
}: RowShell & {
  page: BrowserTab
  computer: string
  runtimeIcon?: RuntimeSnapshot['runtimeIcon']
}) {
  const { name: profile, emoji } = useBrowserProfileDetails(page)
  const words = profile.trim().split(/\s+/)
  const initials = (
    words.length > 1
      ? words
          .slice(0, 2)
          .map((word) => word[0])
          .join('')
      : profile.slice(0, 2)
  ).toUpperCase()
  return (
    <RowFrame kind="Page" title={title} selected={selected} actions={actions}>
      <button
        type="button"
        disabled={disabled}
        aria-current={selected ? 'page' : undefined}
        aria-label={`${title} · ${computer} · ${profile}`}
        title={`${title}\n${page.url}\n${computer} · ${profile}`}
        onClick={onSelect}
        className={cn(
          'studio-browser-tab flex w-full min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-xs transition-colors',
          selected
            ? 'bg-accent/70 text-foreground'
            : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
        )}
      >
        <span className="studio-browser-tab-source flex w-7 shrink-0 flex-col items-center gap-0.5">
          <span className="studio-browser-tab-favicon inline-flex size-6 items-center justify-center">
            <BrowserFavicon tab={page} />
          </span>
          <KindMark icon={Globe2} />
        </span>
        <span className="studio-browser-tab-title min-w-0 flex-1 truncate text-sm">{title}</span>
        <span className="col-start-4 row-span-2 flex items-center gap-1">
          {page.pinned && <Pin aria-label="Pinned" className="size-3 shrink-0" />}
          <LifecycleMark status={status} />
        </span>
        <span
          className="studio-browser-tab-profile flex shrink-0 items-center gap-0.5 text-[8px] leading-none text-muted-foreground"
          aria-hidden="true"
        >
          <span className="studio-browser-tab-identity">
            <RuntimeIcon icon={runtimeIcon} className="size-2 shrink-0" aria-hidden="true" />
          </span>
          <span
            className={cn('studio-browser-tab-identity overflow-hidden', emoji && 'text-[9px]')}
          >
            {emoji ?? initials}
          </span>
        </span>
      </button>
    </RowFrame>
  )
}

/** The thread row's structure for a standalone shell, with the terminal as its primary icon. */
export function WorkspaceTerminalRow({
  project,
  checkout,
  checkoutIsBranch,
  state,
  computer,
  runtimeIcon,
  pinned,
  offline,
  title,
  selected,
  disabled,
  status,
  onSelect,
  actions,
}: RowShell & {
  project: string
  checkout: string
  checkoutIsBranch: boolean
  /** Running, exited… */
  state: string
  computer: string
  runtimeIcon?: RuntimeSnapshot['runtimeIcon']
  pinned: boolean
  offline: boolean
}) {
  const exited = state.startsWith('Exited')
  return (
    <RowFrame kind="Terminal" title={title} selected={selected} actions={actions}>
      <div
        className="studio-thread-row relative w-full min-w-0"
        data-highlighted={selected || undefined}
      >
        <button
          type="button"
          disabled={disabled}
          aria-current={selected ? 'true' : undefined}
          onClick={onSelect}
          className={cn(
            'studio-thread-card mb-[3px] flex min-h-[68px] w-full min-w-0 items-start gap-2.5 rounded-xl border border-transparent px-2.5 py-2 text-left',
            selected ? 'bg-accent/70 hover:bg-accent/80' : 'hover:bg-accent/40',
          )}
        >
          <span className="studio-thread-project-icon shrink-0 pt-0.5">
            <span
              aria-hidden="true"
              className={cn(
                'flex size-7 items-center justify-center rounded-[7px] border bg-background',
                exited ? 'text-muted-foreground' : 'text-foreground',
              )}
            >
              <SquareTerminal className="size-4" strokeWidth={1.7} />
            </span>
          </span>
          <span className="studio-thread-card-body flex min-w-0 flex-1 flex-col items-stretch gap-0.5">
            <span className="studio-thread-card-context flex min-w-0 items-center gap-1.5 text-xs leading-4 text-muted-foreground">
              <span className="min-w-0 flex-1 truncate">{project}</span>
              {pinned && <Pin aria-label="Pinned" className="size-3 shrink-0" />}
              <LifecycleMark status={status} />
              <span className={cn('shrink-0', !exited && !offline && 'text-primary')}>
                {offline ? 'Offline' : state}
              </span>
            </span>
            <span
              className={cn(
                'studio-thread-card-title flex min-w-0 items-center gap-1.5 text-sm font-medium leading-5',
                selected ? 'text-foreground' : 'text-foreground/75 hover:text-foreground',
              )}
            >
              <span className="min-w-0 flex-1 truncate">{title}</span>
            </span>
            <span className="studio-thread-card-context flex min-w-0 items-center gap-1 text-xs leading-4 text-muted-foreground">
              {checkoutIsBranch ? (
                <GitBranch className="size-3 shrink-0" />
              ) : (
                <FolderOpen className="size-3 shrink-0" />
              )}
              <span className="min-w-0 flex-1 truncate">{checkout}</span>
              <RuntimeIcon icon={runtimeIcon} className="size-3.5 shrink-0" aria-label={computer} />
            </span>
          </span>
        </button>
      </div>
    </RowFrame>
  )
}
