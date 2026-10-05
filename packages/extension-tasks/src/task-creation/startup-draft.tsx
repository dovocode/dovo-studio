import { useMemo, useState } from 'react'
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
import type { TaskSource } from '../list/task-collection'
import type { Repository } from '@dovo/studio-core'

export function StartupDraft({
  onProject,
  onCommit,
  onBrowse,
}: {
  onProject: () => void
  onCommit: (task: Task) => void
  onBrowse?: () => void
}) {
  const store = useWorkspace()
  const [selection, setSelection] = useState<{
    runtimeId: string | null
    repositoryId: string
  } | null>(null)
  const repository = store.workspace.repositories.find((item) =>
    selection?.runtimeId === store.activeRuntimeId
      ? item.id === selection.repositoryId
      : item.kind === 'scratch',
  )
  const task = useMemo(
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
  if (!repository)
    return (
      <div className="flex h-full items-center justify-center">
        <Button onClick={onProject}>Choose a project</Button>
      </div>
    )
  return (
    <TemporaryTaskWorkspace key={task.id} task={task} onCommit={onCommit}>
      <StartupComposer
        taskId={task.id}
        onBrowse={onBrowse}
        onSelectRemote={async (source, target) => {
          await store.refreshRuntimes()
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
}: {
  taskId: string
  onBrowse?: () => void
  onSelectRemote: (source: TaskSource, repository: Repository) => Promise<void>
}) {
  const store = useWorkspace()
  const [switching, setSwitching] = useState(false)
  const task = store.workspace.tasks.find((item) => item.id === taskId)
  if (!task) return null
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <h2 className="text-base font-medium">What would you like to work on?</h2>
        <p className="text-sm text-muted-foreground">Describe a change or ask a question.</p>
        {onBrowse && (
          <Button variant="outline" onClick={onBrowse}>
            Browse tasks
          </Button>
        )}
      </div>
      <Composer
        task={task}
        temporary
        onPending={() => {}}
        workspaceControls={
          <ComposerWorkspace
            task={task}
            disabled={switching}
            onMachineMoving={setSwitching}
            onSelectRemote={onSelectRemote}
          />
        }
      />
    </div>
  )
}
