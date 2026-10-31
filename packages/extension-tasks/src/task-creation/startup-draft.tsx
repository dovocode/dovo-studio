import type { WorkspaceControls } from '../chat/composer/composer-workspace'
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  createTask,
  defaultTaskProjectSelection,
  resolveTaskDefaults,
  TemporaryTaskWorkspace,
  useWorkspace,
  type Task,
} from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'
import { ComposerWorkspace } from '../chat/composer/composer-workspace'
import { Composer } from '../chat/composer/composer'
import type { SelectRemoteProject } from '../chat/composer/composer-project'
import { TaskEmptyState } from './task-empty-state'
import type { TaskSource } from '../list/task-collection'
import type { Repository } from '@dovo/studio-core'
import { nextThreadDraft, taskMachineDraft } from '@dovo/protocol'

export function StartupDraft({
  onProject,
  onCommit,
  onBrowse,
  onDraftChange,
  onBackgroundStarted,
  renderThread,
}: {
  onProject: () => void
  onCommit: (task: Task) => void
  onBrowse?: () => void
  onDraftChange?: (task: Task | null, runtimeId: string | null) => void
  onBackgroundStarted?: () => void
  renderThread?: (
    task: Task,
    workspaceControls: WorkspaceControls | undefined,
    temporary: boolean,
    onSelectRemote?: SelectRemoteProject,
    onStartBackground?: (task: Task) => void,
  ) => ReactNode
}) {
  const store = useWorkspace()
  const [selection, setSelection] = useState<{
    runtimeId: string | null
    repositoryId: string
    autoProject?: boolean
    autoProjectExecution?: Task['autoProjectExecution']
    modelSelection?: Task['modelSelection']
    modelSelectionDifficulty?: Task['modelSelectionDifficulty']
    task?: Task
  } | null>(null)
  const [committedTask, setCommittedTask] = useState<Task | null>(null)
  const repository = store.workspace.repositories.find((item) =>
    selection?.runtimeId === store.activeRuntimeId
      ? item.id === selection.repositoryId
      : item.kind === 'scratch',
  )
  const autoProject =
    selection?.runtimeId === store.activeRuntimeId
      ? selection.autoProject
      : defaultTaskProjectSelection(store.snapshot, repository).autoProject
  const initialTask = useMemo(
    () => ({
      ...createTask({
        title: 'New task',
        objective: '',
        agentId: '',
        ...resolveTaskDefaults(store.snapshot?.defaults, repository),
        repositoryId: repository?.id ?? '',
        autoProject,
        autoProjectExecution: selection?.autoProjectExecution,
        modelSelectionDifficulty: selection?.modelSelectionDifficulty,
        ...(autoProject
          ? {
              modelSelection:
                selection?.modelSelection ?? store.snapshot?.autoProjectModelSelection ?? 'inherit',
            }
          : selection?.modelSelection
            ? { modelSelection: selection.modelSelection }
            : {}),
      }),
      harnessCustomized: selection?.modelSelection ? true : undefined,
    }),
    [store.activeRuntimeId, repository?.id],
  )
  // Once saved, repository updates must not create a replacement task/provider.
  const task =
    committedTask ??
    (selection?.runtimeId === store.activeRuntimeId ? selection.task : undefined) ??
    initialTask
  const owner = useRef<{ taskId: string; runtimeId: string | null } | null>(null)
  useLayoutEffect(() => {
    const current = { taskId: task.id, runtimeId: store.activeRuntimeId }
    owner.current = current
    return () => {
      if (owner.current === current) owner.current = null
    }
  }, [task.id, store.activeRuntimeId])
  if (!repository && !committedTask)
    return (
      <div className="flex h-full items-center justify-center">
        <Button onClick={onProject}>Choose a project</Button>
      </div>
    )
  return (
    <TemporaryTaskWorkspace
      key={`${store.activeRuntimeId}:${task.id}`}
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
        onStartBackground={(source) => {
          if (
            owner.current?.taskId !== source.id ||
            owner.current.runtimeId !== store.activeRuntimeId
          )
            return
          const next = nextThreadDraft(source)
          setSelection({
            runtimeId: store.activeRuntimeId,
            repositoryId: next.repositoryId,
            task: next,
          })
          setCommittedTask(null)
          onBackgroundStarted?.()
        }}
        temporary={!committedTask}
        onSelectRemote={async (
          source,
          target,
          autoProject,
          autoProjectExecution,
          modelSelection,
          modelSelectionDifficulty,
          sourceTask,
        ) => {
          setSelection({
            runtimeId: source.runtimeId,
            repositoryId: target.id,
            autoProject,
            autoProjectExecution,
            modelSelection,
            modelSelectionDifficulty,
            task: taskMachineDraft(
              { ...(sourceTask ?? task), autoProject, autoProjectExecution },
              target,
              source.snapshot?.defaults,
              store.workspace.agents,
            ),
          })
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
  onStartBackground,
}: {
  taskId: string
  temporary: boolean
  renderThread?: (
    task: Task,
    workspaceControls: WorkspaceControls | undefined,
    temporary: boolean,
    onSelectRemote?: SelectRemoteProject,
    onStartBackground?: (task: Task) => void,
  ) => ReactNode
  onDraftChange?: (task: Task | null, runtimeId: string | null) => void
  onStartBackground: (task: Task) => void
  onBrowse?: () => void
  onSelectRemote: (
    source: TaskSource,
    repository: Repository,
    autoProject?: boolean,
    autoProjectExecution?: Task['autoProjectExecution'],
    modelSelection?: Task['modelSelection'],
    modelSelectionDifficulty?: Task['modelSelectionDifficulty'],
    sourceTask?: Task,
  ) => Promise<void>
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
  if (renderThread)
    return renderThread(
      task,
      undefined,
      temporary,
      temporary ? onSelectRemote : undefined,
      onStartBackground,
    )
  const workspaceControls: WorkspaceControls = (access) => (
    <ComposerWorkspace
      task={task}
      disabled={switching}
      onMachineMoving={setSwitching}
      onSelectRemote={temporary ? onSelectRemote : undefined}
    >
      {access}
    </ComposerWorkspace>
  )
  return (
    <div
      data-startup-draft=""
      className="startup-draft flex h-full min-h-0 flex-col overflow-y-auto"
    >
      <TaskEmptyState
        task={task}
        disabled={switching}
        onMoving={setSwitching}
        onSelectRemote={temporary ? onSelectRemote : undefined}
        welcome
        onBrowse={onBrowse}
        projectName={
          store.workspace.repositories.find(
            (repo) => repo.id === task.repositoryId && repo.kind !== 'scratch',
          )?.name
        }
      />
      <div className="mb-auto w-full shrink-0 pb-8">
        <Composer
          startup
          onStartBackground={onStartBackground}
          task={task}
          temporary={temporary}
          workspaceMoving={switching}
          onPending={() => {}}
          workspaceControls={workspaceControls}
        />
      </div>
    </div>
  )
}
