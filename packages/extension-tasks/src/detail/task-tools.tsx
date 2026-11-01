import { useEffect, useMemo, useState } from 'react'
import { artifactListSchema, taskSubagents, type Task } from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { startLiveRefresh } from './live-refresh'
import {
  Bot,
  MessageCircleQuestion,
  Files,
  FileCode2,
  GitPullRequest,
  Shapes,
  Globe,
  Smartphone,
  FolderSymlink,
} from 'lucide-react'
import { Button, Tooltip, TooltipContent, TooltipTrigger, cn } from '@dovo/studio-ui'
import type { TaskSurface } from './task-header'

export function TaskTools({
  task,
  surface,
  onSelect,
  hasDiff,
  hasLinkedPulls = false,
  artifactsEnabled = false,
}: {
  task: Task
  surface: TaskSurface
  onSelect: (surface: TaskSurface) => void
  hasDiff: boolean
  hasLinkedPulls?: boolean
  artifactsEnabled?: boolean
}) {
  const { workspace, snapshot, activeRuntimeId, request, connected } = useWorkspace()
  const hasAgents = useMemo(
    () =>
      taskSubagents(task, workspace.tasks).length > 0 ||
      task.threadWatches?.some((watch) => watch.relation === 'spawned') ||
      workspace.tasks.some(
        (child) =>
          child.delegation?.parentTaskId === task.id ||
          (child.spawnParent?.threadId === task.id &&
            [activeRuntimeId, snapshot?.runtimeId].includes(child.spawnParent.runtimeId)),
      ),
    [task, workspace.tasks, activeRuntimeId, snapshot?.runtimeId],
  )
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
        Thread
      </span>
      {(
        [
          {
            label: 'Thread workspace',
            tools: [
              ['files', 'Files', Files],
              ['projects', 'Linked projects', FolderSymlink],
              ...(hasArtifacts ? [['artifacts', 'Artifacts', Shapes] as const] : []),
              ...(hasDiff ? [['changes', 'Diff', FileCode2] as const] : []),
              ...(hasLinkedPulls ? [['linked-pulls', 'Linked PRs', GitPullRequest] as const] : []),
              ...(hasAgents ? [['agents', 'Agents', Bot] as const] : []),
              ['side-chats', 'Side chats', MessageCircleQuestion],
            ],
          },
          {
            label: 'Previews',
            tools: [
              ['browser', 'Browsers', Globe],
              ['devices', 'Devices', Smartphone],
            ],
          },
        ] as const
      ).map(({ label: groupLabel, tools }) => (
        <div className="studio-tools-group" role="group" aria-label={groupLabel} key={groupLabel}>
          {tools.map(([id, label, Icon]) => (
            <Tooltip key={id}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={label}
                  aria-pressed={surface === id}
                  className={cn('studio-navigation-item', surface === id && 'is-active')}
                  onClick={() => onSelect(id)}
                >
                  <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
                  <span className="studio-navigation-label">{label}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" sideOffset={10}>
                {label}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      ))}
    </nav>
  )
}
