import { useEffect, useMemo, useState, type ReactElement } from 'react'
import {
  artifactListSchema,
  botInvocationParent,
  botProjectThread,
  sideThreadAttentionTarget,
  spawnedThreadWatch,
  taskSubagents,
  type Task,
} from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { startLiveRefresh } from './live-refresh'
import { taskPullLinks } from './task-pull-links'
import { useThreadChildren } from './use-thread-children'
import { useSideThreadAttention } from '../chat/thread/side-threads-panel'
import { PanelRightOpen, PanelRightClose, Wrench } from 'lucide-react'
import {
  Button,
  IconButton,
  Popover,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from '@dovo/studio-ui'
import type { TaskSurface } from './task-header'
import { RightPaneTabIcon } from './tool-icons'

/** Icon-only navigation needs tooltips. The picker menu shows text labels, so it skips them. */
function OptionalTooltip({
  label,
  enabled,
  children,
}: {
  label: string
  enabled: boolean
  children: ReactElement
}) {
  if (!enabled) return children
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="left" sideOffset={10}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function TaskTools({
  task,
  picker = false,
  surface,
  onSelect,
  hasDiff,
  hasLinkedPulls = taskPullLinks(task).length > 0,
  toolsExpanded = surface !== 'chat' && surface !== 'terminal',
  onTools,
  bottomTerminalOpen = false,
  terminalDockedRight = false,
  onBottomTerminal,
  artifactsEnabled = false,
}: {
  task: Task
  picker?: boolean
  surface: TaskSurface
  onSelect: (surface: TaskSurface) => void
  hasDiff: boolean
  hasLinkedPulls?: boolean
  toolsExpanded?: boolean
  onTools?: () => void
  bottomTerminalOpen?: boolean
  terminalDockedRight?: boolean
  onBottomTerminal?: () => void
  artifactsEnabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const { workspace, snapshot, activeRuntimeId, request, connected } = useWorkspace()
  const childThreads = useThreadChildren(task.id)
  const agentCount = useMemo(
    () => taskSubagents(task, workspace.tasks).length,
    [task, workspace.tasks],
  )
  const hasAgents = useMemo(
    () =>
      agentCount > 0 ||
      task.threadWatches?.some((watch) => spawnedThreadWatch(task, watch)) ||
      workspace.tasks.some((child) => {
        const call = botInvocationParent(child, snapshot?.runtimeId)
        return (
          (call?.subthread && call.threadId === task.id) ||
          child.delegation?.parentTaskId === task.id ||
          (child.spawnParent?.threadId === task.id &&
            !child.spawnParent.steering &&
            !botProjectThread(!!task.bot, child.repositoryId) &&
            [activeRuntimeId, snapshot?.runtimeId].includes(child.spawnParent.runtimeId))
        )
      }),
    [task, workspace.tasks, activeRuntimeId, snapshot?.runtimeId, agentCount],
  )
  const linkedPullCount = taskPullLinks(task).length
  const sideChatCount = (task.sideChats?.length ?? 0) + childThreads.length
  const attention = useSideThreadAttention()
  const sideAttention = sideThreadAttentionTarget(attention, task.id, attention.peers)?.kind
  const artifactKey = JSON.stringify([activeRuntimeId, task.id])
  const [artifacts, setArtifacts] = useState<{ key: string; present: boolean }>()
  useEffect(() => {
    if (!artifactsEnabled || !connected) return
    let active = true
    // Read the saved library, including artifacts outside the loaded conversation page.
    const stop = startLiveRefresh(
      async () => {
        const result = await request('/api/artifacts/list', { taskId: task.id }, artifactListSchema)
        if (active)
          setArtifacts({
            key: artifactKey,
            present: result.artifacts.length > 0 || !!result.links?.length,
          })
      },
      document,
      (cause) => {
        if (!active) return
        console.warn('Could not check thread artifacts', cause)
        // Keep the library accessible when discovery fails; its panel displays the read error.
        setArtifacts((previous) =>
          previous?.key === artifactKey ? previous : { key: artifactKey, present: true },
        )
      },
    )
    return () => {
      active = false
      stop()
    }
  }, [artifactKey, task.id, task.status, artifactsEnabled, connected, request])
  const hasArtifacts = artifactsEnabled && artifacts?.key === artifactKey && artifacts.present
  const terminalActive = terminalDockedRight ? surface === 'terminal' : bottomTerminalOpen
  const terminalLabel = terminalDockedRight
    ? terminalActive
      ? 'Hide right terminal'
      : 'Show right terminal'
    : terminalActive
      ? 'Hide bottom terminal'
      : 'Show bottom terminal'
  const navigation = (
    <nav
      className={picker ? 'flex flex-col gap-1' : 'studio-navigation studio-tools-navigation'}
      aria-label="Thread tools"
    >
      {!picker && (
        <span className="studio-navigation-heading" aria-hidden="true">
          {task.bot ? 'Bot' : 'Thread'}
        </span>
      )}
      <div data-tools-pane-control className={picker ? 'border-b pb-1' : 'mb-3 shrink-0'}>
        <OptionalTooltip
          label={toolsExpanded ? 'Hide tools pane' : 'Show tools pane'}
          enabled={!picker}
        >
          <Button
            variant="ghost"
            size="icon"
            aria-label={toolsExpanded ? 'Hide tools pane' : 'Show tools pane'}
            aria-pressed={toolsExpanded}
            className={
              picker ? 'h-8 w-full justify-start gap-2 px-2 text-xs' : 'studio-navigation-item'
            }
            onClick={() => {
              if (picker) setOpen(false)
              if (onTools) onTools()
              else onSelect(toolsExpanded ? 'chat' : 'files')
            }}
          >
            {toolsExpanded ? (
              <PanelRightClose size={17} strokeWidth={1.7} />
            ) : (
              <PanelRightOpen size={17} strokeWidth={1.7} />
            )}
            {picker && (toolsExpanded ? 'Hide tools pane' : 'Show tools pane')}
          </Button>
        </OptionalTooltip>
      </div>
      {(
        [
          ...(task.bot
            ? ([
                {
                  label: 'Bot',
                  tools: [
                    ['bot-settings', 'Settings', 0],
                    ['bot-mcp', 'MCP servers', 0],
                    ['bot-skills', 'Skills', 0],
                    ['bot-memory', 'Memory', 0],
                    ['bot-routines', 'Routines', 0],
                    ['files', 'Files', 0],
                    ['side-chats', 'Side threads', sideChatCount],
                  ],
                },
              ] as const)
            : []),
          {
            label: 'Thread workspace',
            tools: [
              ...(task.bot ? [] : [['files', 'Files', 0] as const]),
              ...(task.bot ? [] : [['projects', 'Linked projects', 0] as const]),
              ...(hasArtifacts ? [['artifacts', 'Artifacts', 0] as const] : []),
              ...(hasDiff ? [['changes', 'Diff', task.files?.length ?? 0] as const] : []),
              ...(hasLinkedPulls ? [['linked-pulls', 'Linked PRs', linkedPullCount] as const] : []),
              ...(hasAgents ? [['agents', 'Agents', agentCount] as const] : []),
              ...(task.bot ? [] : [['side-chats', 'Side chats', sideChatCount] as const]),
            ],
          },
          {
            label: 'Previews',
            tools: [
              ['terminal', 'Terminal', 0],
              ['browser', 'Browsers', 0],
              ['devices', 'Devices', 0],
            ],
          },
        ] as const
      )
        .filter(({ tools }) => tools.length > 0)
        .map(({ label: groupLabel, tools }) => (
          <div
            className={picker ? 'flex flex-col gap-0.5' : 'studio-tools-group'}
            role="group"
            aria-label={groupLabel}
            key={groupLabel}
          >
            {tools.map(([id, label, count]) => (
              <OptionalTooltip
                key={id}
                enabled={!picker}
                label={
                  id === 'terminal' ? terminalLabel : count > 0 ? `${label} (${count})` : label
                }
              >
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={id === 'terminal' ? terminalLabel : label}
                  aria-description={
                    [
                      count > 0 ? `${count} ${label.toLowerCase()}` : '',
                      id === 'side-chats' && sideAttention
                        ? sideAttention === 'approval'
                          ? 'Approval required'
                          : 'Needs input'
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' · ') || undefined
                  }
                  aria-pressed={id === 'terminal' ? terminalActive : surface === id}
                  className={cn(
                    picker
                      ? 'relative h-8 w-full justify-start gap-2 px-2 text-xs aria-pressed:bg-accent'
                      : 'studio-navigation-item',
                    (id === 'terminal' ? terminalActive : surface === id) && 'is-active',
                  )}
                  onClick={() => {
                    if (picker) setOpen(false)
                    if (id === 'terminal' && onBottomTerminal) onBottomTerminal()
                    else onSelect(id)
                  }}
                >
                  <RightPaneTabIcon tab={id} size={18} strokeWidth={1.7} />
                  <span className={picker ? undefined : 'studio-navigation-label'}>{label}</span>
                  {(count > 0 || (id === 'side-chats' && sideAttention)) && (
                    <span
                      data-tool-count
                      data-attention={
                        id === 'side-chats' && sideAttention ? sideAttention : undefined
                      }
                      aria-hidden="true"
                      className={cn(
                        'pointer-events-none absolute right-0.5 top-0.5 min-w-3 rounded px-0.5 text-center text-[0.5625rem] leading-3 tabular-nums',
                        id === 'side-chats' && sideAttention
                          ? 'bg-status-warning/15 text-status-warning'
                          : 'bg-background text-muted-foreground',
                      )}
                    >
                      {count > 99 ? '99+' : count || '•'}
                    </span>
                  )}
                </Button>
              </OptionalTooltip>
            ))}
          </div>
        ))}
    </nav>
  )
  if (!picker) return navigation
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <IconButton label="Thread tools" className="size-7 shrink-0" title="Thread tools">
          <Wrench size={15} aria-hidden="true" />
        </IconButton>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="studio-menu-surface z-50 w-48 max-h-[var(--radix-popover-content-available-height)] overflow-auto rounded-xl border bg-popover p-1"
        >
          {navigation}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
