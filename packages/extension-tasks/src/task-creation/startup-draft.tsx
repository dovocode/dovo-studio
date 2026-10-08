import { useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import {
  createTask,
  resolveTaskDefaults,
  TemporaryTaskWorkspace,
  useWorkspace,
  type Task,
} from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'
import { ComposerWorkspace } from '../chat/composer/composer-workspace'
import { Composer } from '../chat/composer/composer'
import { TaskEmptyState } from './task-empty-state'
import type { TaskSource } from '../list/task-collection'
import type { Repository } from '@dovo/studio-core'

export function StartupDraft({
  onProject,
  onCommit,
  onBrowse,
  onDraftChange,
  renderThread,
}: {
  onProject: () => void
  onCommit: (task: Task) => void
  onBrowse?: () => void
  onDraftChange?: (task: Task | null, runtimeId: string | null) => void
  renderThread?: (task: Task, workspaceControls: ReactNode, temporary: boolean) => ReactNode
}) {
  const store = useWorkspace()
  const [selection, setSelection] = useState<{
    runtimeId: string | null
    repositoryId: string
  } | null>(null)
  const [committedTask, setCommittedTask] = useState<Task | null>(null)
  const repository = store.workspace.repositories.find((item) =>
    selection?.runtimeId === store.activeRuntimeId
      ? item.id === selection.repositoryId
      : item.kind === 'scratch',
  )
  const initialTask = useMemo(
    () =>
      createTask({
        title: 'New task',
        objective: '',
        agentId: '',
        ...resolveTaskDefaults(store.snapshot?.defaults, repository),
        repositoryId: repository?.id ?? '',
      }),
    [store.activeRuntimeId, repository?.id],
  )
  // Once saved, repository updates must not create a replacement task/provider.
  const task = committedTask ?? initialTask
  if (!repository && !committedTask)
    return (
      <div className="flex h-full items-center justify-center">
        <Button onClick={onProject}>Choose a project</Button>
      </div>
    )
  return (
    <TemporaryTaskWorkspace
      key={task.id}
      task={task}
      onCommit={(task) => {
        setCommittedTask(task)
        onCommit(task)
      }}
    >
      <StartupComposer
        taskId={task.id}
        onBrowse={onBrowse}
        onDraftChange={onDraftChange}
        renderThread={renderThread}
        temporary={!committedTask}
        onSelectRemote={async (source, target) => {
          setSelection({ runtimeId: source.runtimeId, repositoryId: target.id })
          await store.switchRuntime(source.runtimeId ?? '')
        }}
      />
    </TemporaryTaskWorkspace>
  )
}

function StartupComposer({
  taskId,
  onBrowse,
  onSelectRemote,
  onDraftChange,
  renderThread,
  temporary,
}: {
  taskId: string
  temporary: boolean
  renderThread?: (task: Task, workspaceControls: ReactNode, temporary: boolean) => ReactNode
  onDraftChange?: (task: Task | null, runtimeId: string | null) => void
  onBrowse?: () => void
  onSelectRemote: (source: TaskSource, repository: Repository) => Promise<void>
}) {
  const store = useWorkspace()
  const [switching, setSwitching] = useState(false)
  const task = store.workspace.tasks.find((item) => item.id === taskId)
  // Publish before paint so the sidebar never renders a frame without its selected draft.
  useLayoutEffect(() => {
    onDraftChange?.(task ?? null, store.activeRuntimeId)
  }, [task, store.activeRuntimeId, onDraftChange])
  useLayoutEffect(
    () => () => onDraftChange?.(null, store.activeRuntimeId),
    [store.activeRuntimeId, onDraftChange],
  )
  if (!task) return null
  const workspaceControls = (
    <ComposerWorkspace
      task={task}
      disabled={switching}
      onMachineMoving={setSwitching}
      onSelectRemote={temporary ? onSelectRemote : undefined}
    />
  )
  if (renderThread) return renderThread(task, workspaceControls, temporary)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <TaskEmptyState onBrowse={onBrowse} />
      <Composer
        task={task}
        temporary={temporary}
        onPending={() => {}}
        workspaceControls={workspaceControls}
      />
    </div>
  )
}
