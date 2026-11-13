import { useEffect, useMemo, useState } from 'react'
import {
  artifactListSchema,
  sideThreadAttentionTarget,
  taskSubagents,
  type Task,
} from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { startLiveRefresh } from './live-refresh'
import { taskPullLinks } from './task-pull-links'
import { sideThreadsOf } from './side-threads'
import { useSideThreadAttention } from '../chat/thread/side-threads-panel'
import {
  Bot,
  MessagesSquare,
  Files,
  FileCode2,
  GitPullRequest,
  Shapes,
  Globe,
  Smartphone,
  FolderSymlink,
  PanelRightOpen,
  PanelRightClose,
  PanelBottom,
  Plug,
  BookOpen,
  Brain,
  Workflow,
} from 'lucide-react'
import { Button, Tooltip, TooltipContent, TooltipTrigger, cn } from '@dovo/studio-ui'
import type { TaskSurface } from './task-header'

export function TaskTools({
  task,
  surface,
  onSelect,
  hasDiff,
  hasLinkedPulls = taskPullLinks(task).length > 0,
  toolsExpanded = surface !== 'chat' && surface !== 'terminal',
  onTools,
  bottomTerminalOpen = false,
  onBottomTerminal,
  artifactsEnabled = false,
}: {
  task: Task
  surface: TaskSurface
  onSelect: (surface: TaskSurface) => void
  hasDiff: boolean
  hasLinkedPulls?: boolean
  toolsExpanded?: boolean
  onTools?: () => void
  bottomTerminalOpen?: boolean
  onBottomTerminal?: () => void
  artifactsEnabled?: boolean
}) {
  const { workspace, snapshot, activeRuntimeId, request, connected } = useWorkspace()
  const agentCount = useMemo(
    () => taskSubagents(task, workspace.tasks).length,
    [task, workspace.tasks],
  )
  const hasAgents = useMemo(
    () =>
      agentCount > 0 ||
      task.threadWatches?.some((watch) => watch.relation === 'spawned') ||
      workspace.tasks.some(
        (child) =>
          child.delegation?.parentTaskId === task.id ||
          (child.spawnParent?.threadId === task.id &&
            [activeRuntimeId, snapshot?.runtimeId].includes(child.spawnParent.runtimeId)),
      ),
    [task, workspace.tasks, activeRuntimeId, snapshot?.runtimeId, agentCount],
  )
  const linkedPullCount = taskPullLinks(task).length
  const sideChatCount =
    (task.sideChats?.length ?? 0) + sideThreadsOf(workspace.tasks, task.id).length
  const sideAttention = sideThreadAttentionTarget(useSideThreadAttention(), task.id)?.kind
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
  return (
    <nav className="studio-navigation studio-tools-navigation" aria-label="Thread tools">
      <span className="studio-navigation-heading" aria-hidden="true">
        {task.bot ? 'Bot' : 'Thread'}
      </span>
      <div data-tools-pane-control className="mb-3 shrink-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={toolsExpanded ? 'Hide tools pane' : 'Show tools pane'}
              aria-pressed={toolsExpanded}
              className="studio-navigation-item"
              onClick={onTools ?? (() => onSelect(toolsExpanded ? 'chat' : 'files'))}
            >
              {toolsExpanded ? (
                <PanelRightClose size={17} strokeWidth={1.7} />
              ) : (
                <PanelRightOpen size={17} strokeWidth={1.7} />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left" sideOffset={10}>
            {toolsExpanded ? 'Hide tools pane' : 'Show tools pane'}
          </TooltipContent>
        </Tooltip>
      </div>
      {(
        [
          ...(task.bot
            ? ([
                {
                  label: 'Bot',
                  tools: [
                    ['bot-settings', 'Bot settings', Bot, 0],
                    ['bot-mcp', 'Bot MCP servers', Plug, 0],
                    ['bot-skills', 'Bot skills', BookOpen, 0],
                    ['bot-memory', 'Bot memory', Brain, 0],
                    ['bot-routines', 'Bot routines', Workflow, 0],
                  ],
                },
              ] as const)
            : []),
          {
            label: 'Thread workspace',
            tools: [
              ['files', 'Files', Files, 0],
              ...(task.bot ? [] : [['projects', 'Linked projects', FolderSymlink, 0] as const]),
              ...(hasArtifacts ? [['artifacts', 'Artifacts', Shapes, 0] as const] : []),
              ...(hasDiff
                ? [['changes', 'Diff', FileCode2, task.files?.length ?? 0] as const]
                : []),
              ...(hasLinkedPulls
                ? [['linked-pulls', 'Linked PRs', GitPullRequest, linkedPullCount] as const]
                : []),
              ...(hasAgents ? [['agents', 'Agents', Bot, agentCount] as const] : []),
              ['side-chats', 'Side chats', MessagesSquare, sideChatCount],
            ],
          },
          {
            label: 'Previews',
            tools: [
              ['terminal', 'Terminal', PanelBottom, 0],
              ['browser', 'Browsers', Globe, 0],
              ['devices', 'Devices', Smartphone, 0],
            ],
          },
        ] as const
      ).map(({ label: groupLabel, tools }) => (
        <div className="studio-tools-group" role="group" aria-label={groupLabel} key={groupLabel}>
          {tools.map(([id, label, Icon, count]) => (
            <Tooltip key={id}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={
                    id === 'terminal'
                      ? bottomTerminalOpen
                        ? 'Hide bottom terminal'
                        : 'Show bottom terminal'
                      : label
                  }
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
                  aria-pressed={id === 'terminal' ? bottomTerminalOpen : surface === id}
                  className={cn(
                    'studio-navigation-item',
                    (id === 'terminal' ? bottomTerminalOpen : surface === id) && 'is-active',
                  )}
                  onClick={() =>
                    id === 'terminal' && onBottomTerminal ? onBottomTerminal() : onSelect(id)
                  }
                >
                  <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
                  <span className="studio-navigation-label">{label}</span>
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
              </TooltipTrigger>
              <TooltipContent side="left" sideOffset={10}>
                {id === 'terminal'
                  ? bottomTerminalOpen
                    ? 'Hide bottom terminal'
                    : 'Show bottom terminal'
                  : count > 0
                    ? `${label} (${count})`
                    : label}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      ))}
    </nav>
  )
}
