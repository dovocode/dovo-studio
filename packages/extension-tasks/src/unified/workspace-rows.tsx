import type { ReactNode } from 'react'
import {
  AlarmClock,
  Check,
  GitBranch,
  FolderOpen,
  ExternalLink,
  Globe2,
  MessageSquare,
  Pin,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react'
import type { Task } from '@dovo/studio-core'
import { cn } from '@dovo/studio-ui'
import { RuntimeIcon } from '@dovo/studio-ui/runtime-icon'
import {
  browserTabBadge,
  browserTabKeepsAwake,
  type BrowserTabState,
  type RuntimeSnapshot,
} from '@dovo/protocol'
import { BrowserTabActivity } from '../browser/browser-tab-activity'
import { TaskRow } from '../list/task-row'
import type { TaskOwner } from '../list/task-collection'
import type { NestedThread } from '../list/thread-tree'
import { BrowserFavicon } from '../browser/browser-favicon'
import { useBrowserProfileDetails } from '../browser/browser-profile-label'
import type { BrowserTab } from '../browser/shared-browser-tabs'
import type { TerminalStatusTone } from '../terminal/terminal-status'

export type WorkspaceRowStatus = 'active' | 'snoozed' | 'settled'
type RowShell = {
  title: string
  selected: boolean
  disabled: boolean
  status: WorkspaceRowStatus
  onSelect: () => void
  /** The item's direct Pin / Settle / Snooze actions. */
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
  pinnedPage = false,
}: {
  kind: 'Thread' | 'Page' | 'Terminal'
  title: string
  selected: boolean
  children: ReactNode
  actions: ReactNode
  compact?: boolean
  pinnedPage?: boolean
}) {
  return (
    <div
      role="group"
      aria-label={`${kind}: ${title}`}
      data-workspace-kind={kind.toLowerCase()}
      data-compact={compact || undefined}
      data-pinned-page={pinnedPage || undefined}
      data-highlighted={selected || undefined}
      className={cn(
        'studio-workspace-row group/workspace relative min-w-0',
        !pinnedPage &&
          'mb-[3px] [&:hover_.studio-thread-card-context:first-child]:pr-28 [&:focus-within_.studio-thread-card-context:first-child]:pr-28 has-[[data-state=open]]:[&_.studio-thread-card-context:first-child]:pr-28 [&:hover_.studio-browser-tab-title]:pr-28 [&:focus-within_.studio-browser-tab-title]:pr-28 has-[[data-state=open]]:[&_.studio-browser-tab-title]:pr-28 [@media(hover:none)]:[&_.studio-thread-card-context:first-child]:pr-28 [@media(hover:none)]:[&_.studio-browser-tab-title]:pr-28',
      )}
    >
      <div className={cn('relative min-w-0', compact && '[&_.studio-thread-card-title]:pr-24')}>
        {children}
      </div>
      <div
        data-workspace-actions
        className={cn(
          'absolute pointer-events-none opacity-0 transition-opacity group-hover/workspace:pointer-events-auto group-hover/workspace:opacity-100 group-focus-within/workspace:pointer-events-auto group-focus-within/workspace:opacity-100 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100',
          pinnedPage
            ? 'inset-x-px bottom-px overflow-hidden rounded-b-xl border-t bg-popover text-popover-foreground [&_.studio-thread-actions]:gap-0 [&_button]:h-6 [&_button]:min-w-0 [&_button]:flex-1 [&_button]:gap-0 [&_button]:rounded-none [&_button]:px-0 [&_button]:text-[0px] [&_svg]:size-3'
            : 'right-2 top-0.5 [[data-compact]_&]:top-1.5',
        )}
      >
        {actions}
      </div>
    </div>
  )
}

/**
 * The thread list's own row, with its existing project, status and terminal identity.
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
  thread,
  selectedThreadKey,
  searching,
}: RowShell & {
  task: Task
  owner: TaskOwner
  needsInput: boolean
  terminals: number
  thread?: NestedThread
  selectedThreadKey?: string
  searching: boolean
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
        thread={thread}
        selectedThreadKey={selectedThreadKey}
        searching={searching}
        editable={false}
        disabled={disabled}
      />
      <KindMark
        icon={MessageSquare}
        className={cn('absolute', compact ? 'left-[20px] top-[18px]' : 'left-[17px] top-[40px]')}
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
  pinnedPage = false,
  activity,
  onMute,
}: RowShell & {
  page: BrowserTab
  computer: string
  runtimeIcon?: RuntimeSnapshot['runtimeIcon']
  /** Only the sidebar's pinned browser grid uses the Browser workspace's compact tile. */
  pinnedPage?: boolean
  activity?: BrowserTabState
  onMute?: () => void
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
  const badge = activity?.badge ?? browserTabBadge(page.title)
  return (
    <RowFrame
      kind="Page"
      title={title}
      selected={selected}
      actions={actions}
      pinnedPage={pinnedPage}
    >
      {pinnedPage ? (
        <div
          data-browser-tab-id={page.id}
          data-pinned
          data-detached={!!page.detached || undefined}
          data-active={selected || undefined}
          className={cn(
            'studio-browser-tab relative flex min-w-0 flex-col overflow-hidden rounded-xl border pb-6 transition-colors',
            selected
              ? 'border-primary/30 bg-accent text-foreground shadow-sm'
              : 'border-border/50 bg-background/50 text-muted-foreground hover:border-border hover:bg-accent/40 hover:text-foreground',
          )}
        >
          <button
            type="button"
            data-browser-tab-select
            disabled={disabled}
            aria-current={selected ? 'page' : undefined}
            aria-label={`${title} · ${computer} · ${profile}${page.detached ? ' · Open in detached window' : ''}`}
            title={`${title}\n${page.url}\n${computer} · ${profile}${page.detached ? '\nOpen in detached window' : ''}`}
            onClick={onSelect}
            className="studio-browser-tab-select flex h-14 w-full min-w-0 flex-none items-center justify-center px-2 py-2 text-left text-xs"
          >
            <span
              className="studio-browser-pin-status"
              data-awake={!!activity || browserTabKeepsAwake(page) || undefined}
              aria-label={
                browserTabKeepsAwake(page)
                  ? 'Kept awake'
                  : activity
                    ? 'Page loaded'
                    : 'Page sleeping'
              }
            />
            <span className="studio-browser-tab-source relative inline-flex h-10 w-8 shrink-0 items-start justify-center">
              <span className="studio-browser-tab-favicon relative inline-flex size-8 items-center justify-center">
                <BrowserFavicon tab={page} />
                {badge !== undefined && (
                  <span
                    aria-label={badge === 'unread' ? 'Unread activity' : `${badge} unread`}
                    className={cn(
                      'studio-browser-tab-badge absolute -right-1 -top-1 rounded-full bg-primary text-primary-foreground ring-2 ring-sidebar',
                      badge === 'unread'
                        ? 'size-2'
                        : 'min-w-3.5 px-1 text-center text-[9px] font-semibold leading-3.5',
                    )}
                  >
                    {badge === 'unread' ? null : badge > 99 ? '99+' : badge}
                  </span>
                )}
                {status !== 'active' && (
                  <span className="absolute -right-1 -top-0.5 rounded-full bg-sidebar">
                    <LifecycleMark status={status} />
                  </span>
                )}
              </span>
            </span>
          </button>
          <BrowserTabActivity state={activity} title={title} pinned onMute={onMute} />
          {page.detached && (
            <ExternalLink
              size={10}
              aria-hidden
              className="pointer-events-none absolute bottom-1 right-1 text-muted-foreground"
            />
          )}
        </div>
      ) : (
        <div
          data-active={selected || undefined}
          className={cn(
            'studio-browser-tab relative min-w-0 rounded-xl',
            selected
              ? 'bg-accent/70 text-foreground'
              : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
          )}
        >
          <button
            type="button"
            disabled={disabled}
            aria-current={selected ? 'page' : undefined}
            aria-label={`${title} · ${computer} · ${profile}`}
            title={`${title}\n${page.url}\n${computer} · ${profile}`}
            onClick={onSelect}
            className="studio-browser-tab-select min-w-0 text-left text-xs"
          >
            <span className="studio-browser-tab-source flex w-7 shrink-0 flex-col items-center gap-0.5">
              <span className="studio-browser-tab-favicon inline-flex size-6 items-center justify-center">
                <BrowserFavicon tab={page} />
              </span>
              <KindMark icon={Globe2} />
            </span>
            <span className="studio-browser-tab-title min-w-0 flex-1 truncate text-sm">
              {title}
            </span>
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
          <BrowserTabActivity state={activity} title={title} onMute={onMute} />
        </div>
      )}
    </RowFrame>
  )
}

/** The thread row's structure for a standalone shell, with the terminal as its primary icon. */
export function WorkspaceTerminalRow({
  project,
  checkout,
  checkoutIsBranch,
  state,
  stateTone = 'muted',
  stateDetail,
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
  /** Program-reported activity or the shared fallback label. */
  state: string
  stateTone?: TerminalStatusTone
  stateDetail?: string
  computer: string
  runtimeIcon?: RuntimeSnapshot['runtimeIcon']
  pinned: boolean
  offline: boolean
}) {
  const exited = state.startsWith('Exited')
  const toneClass = {
    muted: 'text-muted-foreground',
    working: 'text-primary',
    warning: 'text-status-warning',
    success: 'text-status-success',
    error: 'text-destructive',
  }[offline ? 'muted' : stateTone]
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
              <span title={stateDetail} className={cn('shrink-0', toneClass)}>
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
