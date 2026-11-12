import { memo, useCallback, useEffect, useMemo, useRef, useId, type ReactNode } from 'react'
import {
  AlarmClock,
  Check,
  GitBranch,
  FolderOpen,
  Pin,
  SquareTerminal,
  MessageSquare,
  type LucideIcon,
} from 'lucide-react'
import type { Task } from '@dovo/studio-core'
import { cn } from '@dovo/studio-ui'
import { RuntimeIcon } from '@dovo/studio-ui/runtime-icon'
import { type RuntimeSnapshot, type ThreadSearchFilter } from '@dovo/protocol'
import type { BrowserTabTarget } from '../browser/browser-pane'
import { TaskContextMenu } from '../detail/task-context-menu'
import { TaskRow } from '../list/task-row'
import type { TaskOwner } from '../list/task-collection'
import type { NestedThread } from '../list/thread-tree'
import type { BrowserTab } from '../browser/shared-browser-tabs'
import {
  useWorkspaceResourceActions,
  type WorkspaceResourceMenuProps,
} from './workspace-resource-menu'
import { TerminalContextMenu, type TerminalContextActions } from '../terminal/terminal-context-menu'
import type { TerminalStatusTone } from '../terminal/terminal-status'

export type WorkspaceRowStatus = 'active' | 'snoozed' | 'settled'
type RowShell = {
  title: string
  selected: boolean
  disabled: boolean
  status: WorkspaceRowStatus
  onSelect: () => void
  /** The item's direct Pin / Settle / Snooze actions. */
  actions: WorkspaceResourceMenuProps
}

/** Type identity stays in the title's normal flow, including compact and wrapped rows. */
function KindMark({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span
      aria-hidden="true"
      data-workspace-kind-icon
      className="pointer-events-none inline-flex size-3.5 shrink-0 items-center justify-center text-muted-foreground"
    >
      <Icon className="size-3.5" strokeWidth={1.7} />
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
  contextMenu,
}: {
  kind: 'Thread' | 'Page' | 'Terminal'
  title: string
  selected: boolean
  children: ReactNode
  actions: WorkspaceResourceMenuProps
  compact?: boolean
  pinnedPage?: boolean
  contextMenu?: (row: ReactNode, lifecycle: ReactNode) => ReactNode
}) {
  const menus = useWorkspaceResourceActions(actions)
  const row = (
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
          'mb-[3px] [&:hover_.studio-thread-card-context:first-child]:pr-28 [&:focus-within_.studio-thread-card-context:first-child]:pr-28 has-[[data-state=open]]:[&_.studio-thread-card-context:first-child]:pr-28 [@media(hover:none)]:[&_.studio-thread-card-context:first-child]:pr-28',
      )}
    >
      <div className={cn('relative min-w-0', compact && '[&_.studio-thread-card-title]:pr-24')}>
        {children}
      </div>
      {kind !== 'Page' && (
        <div
          data-workspace-actions
          className={cn(
            'absolute pointer-events-none opacity-0 transition-opacity group-hover/workspace:pointer-events-auto group-hover/workspace:opacity-100 group-focus-within/workspace:pointer-events-auto group-focus-within/workspace:opacity-100 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100',
            'right-2 top-0.5 [[data-compact]_&]:top-1.5',
          )}
        >
          {menus.inline}
        </div>
      )}
    </div>
  )
  return (
    <>
      {contextMenu ? contextMenu(row, menus.context) : row}
      {menus.dialog}
    </>
  )
}

/**
 * The thread list's own row, with its existing project, status and terminal identity.
 */
export type WorkspaceThreadCommands = {
  open: (key: string) => void
  pin: (key: string) => void
  settle: (key: string) => void
  snooze: (key: string, until: string | null) => void
  create: (key: string, templateId?: string) => void
  filter: (key: string) => void
  deselect: () => void
  error: (message: string) => void
}

export const WorkspaceThreadRow = memo(function WorkspaceThreadRow({
  rowKey,
  commands,
  task,
  owner,
  needsInput,
  terminals,
  title,
  selected,
  disabled,
  pinned,
  settled,
  snoozedUntil,
  actionDisabled,
  settleDisabled,
  thread,
  selectedThreadKey,
  searching,
  search,
  revealSearch,
}: {
  rowKey: string
  commands: WorkspaceThreadCommands
  title: string
  selected: boolean
  disabled: boolean
  pinned: boolean
  settled: boolean
  snoozedUntil?: string
  actionDisabled: boolean
  settleDisabled?: boolean
  task: Task
  owner: TaskOwner
  needsInput: boolean
  terminals: number
  thread?: NestedThread
  selectedThreadKey?: string
  searching: boolean
  search?: ThreadSearchFilter
  revealSearch?: boolean
}) {
  const onSelect = useCallback(() => commands.open(rowKey), [commands, rowKey])
  const actions = useMemo<WorkspaceResourceMenuProps>(
    () => ({
      title,
      pinned,
      settled,
      snoozedUntil,
      disabled: actionDisabled,
      settleDisabled,
      onPin: () => commands.pin(rowKey),
      onSettle: () => commands.settle(rowKey),
      onSnooze: (until) => commands.snooze(rowKey, until),
    }),
    [commands, rowKey, title, pinned, settled, snoozedUntil, actionDisabled, settleDisabled],
  )
  const menu = useMemo(
    () => ({
      onCreate: () => commands.create(rowKey),
      onTemplate: (templateId: string) => commands.create(rowKey, templateId),
      onFilter: () => commands.filter(rowKey),
      onDeselect: commands.deselect,
      onError: commands.error,
    }),
    [commands, rowKey],
  )
  const compact = task.archived || !!task.archivedAt
  return (
    <RowFrame
      kind="Thread"
      title={title}
      selected={selected}
      actions={actions}
      compact={compact}
      contextMenu={(row) => (
        <TaskContextMenu
          task={task}
          owner={owner}
          selected={selected}
          busy={disabled || !!actions.disabled}
          onOpen={onSelect}
          {...menu}
        >
          {row}
        </TaskContextMenu>
      )}
    >
      <TaskRow
        titleIcon={<KindMark icon={MessageSquare} />}
        task={task}
        owner={owner}
        selected={selected}
        onSelect={onSelect}
        needsInput={needsInput}
        terminals={terminals}
        thread={thread}
        selectedThreadKey={selectedThreadKey}
        searching={searching}
        search={search}
        revealSearch={revealSearch}
        editable={false}
        disabled={disabled}
      />
    </RowFrame>
  )
})

/** BrowserPane portals its own row here, keeping every native menu action and dialog. */
export function WorkspacePageRow({
  page,
  title,
  selected,
  disabled,
  actions,
  pinnedPage = false,
  registerTabTarget,
}: RowShell & {
  page: BrowserTab
  pinnedPage?: boolean
  registerTabTarget: (target: BrowserTabTarget | null, element: HTMLDivElement) => void
}) {
  const key = useId()
  const element = useRef<HTMLDivElement | null>(null)
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      if (element.current) registerTabTarget(null, element.current)
      element.current = node
    },
    [registerTabTarget],
  )
  useEffect(() => {
    const node = element.current
    if (!node) return
    registerTabTarget(
      { key, tabId: page.id, element: node, pinnedTile: pinnedPage, active: selected, disabled },
      node,
    )
    return () => registerTabTarget(null, node)
  }, [key, page.id, pinnedPage, selected, disabled, registerTabTarget])
  return (
    <RowFrame
      kind="Page"
      title={title}
      selected={selected}
      actions={actions}
      pinnedPage={pinnedPage}
    >
      <div ref={attach} />
    </RowFrame>
  )
}

/** The thread row's structure for a standalone shell, with its type beside the title. */
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
  menu,
}: RowShell & {
  menu: TerminalContextActions
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
  const toneClass = {
    muted: 'text-muted-foreground',
    working: 'text-primary',
    warning: 'text-status-warning',
    success: 'text-status-success',
    error: 'text-destructive',
  }[offline ? 'muted' : stateTone]
  return (
    <RowFrame
      kind="Terminal"
      title={title}
      selected={selected}
      actions={actions}
      contextMenu={(row, lifecycle) => (
        <TerminalContextMenu
          {...menu}
          selected={selected}
          disabled={disabled || !!actions.disabled}
          onOpen={onSelect}
          lifecycle={lifecycle}
        >
          {row}
        </TerminalContextMenu>
      )}
    >
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
          <span className="studio-thread-card-body flex min-w-0 flex-1 flex-col items-stretch gap-0.5">
            <span className="studio-thread-card-context flex min-w-0 items-center gap-1.5 text-xs leading-4 text-muted-foreground">
              <FolderOpen className="size-4 shrink-0" aria-hidden="true" />
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
              <KindMark icon={SquareTerminal} />
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
