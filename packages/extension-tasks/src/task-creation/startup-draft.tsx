import { useMemo, useState } from 'react'
import {
  createTask,
  resolveTaskDefaults,
  TemporaryTaskWorkspace,
  useWorkspace,
  type Task,
} from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'
import { Folder, Monitor } from 'lucide-react'
import { Composer } from '../chat/composer/composer'
import { taskSources } from '../list/task-collection'

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
  const repository = store.workspace.repositories.find((item) => item.kind === 'scratch')
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
      <StartupComposer taskId={task.id} onProject={onProject} onBrowse={onBrowse} />
    </TemporaryTaskWorkspace>
  )
}

function StartupComposer({
  taskId,
  onProject,
  onBrowse,
}: {
  taskId: string
  onProject: () => void
  onBrowse?: () => void
}) {
  const store = useWorkspace()
  const [error, setError] = useState('')
  const [switching, setSwitching] = useState(false)
  const task = store.workspace.tasks.find((item) => item.id === taskId)
  const sources = taskSources(store)
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
          <div className="relative mx-auto -mt-3 flex w-[calc(100%-24px)] max-w-[744px] items-center gap-2 rounded-b-xl border border-t-0 bg-muted/15 px-2 pb-1.5 pt-4 text-muted-foreground">
            <Monitor className="size-3" />
            <select
              aria-label="Environment"
              disabled={switching}
              value={store.activeRuntimeId ?? ''}
              className="max-w-48 bg-transparent text-xs"
              onChange={(event) => {
                setSwitching(true)
                setError('')
                void store
                  .switchRuntime(event.target.value)
                  .catch((cause: unknown) => setError(String(cause)))
                  .finally(() => setSwitching(false))
              }}
            >
              {sources.map((source) => (
                <option
                  key={source.runtimeId ?? 'local'}
                  value={source.runtimeId ?? ''}
                  disabled={!source.online}
                >
                  {source.name}
                  {source.online ? '' : ' · Offline'}
                </option>
              ))}
            </select>
            <Button
              variant="ghost"
              className="h-6 gap-1.5 px-2 text-xs font-normal"
              onClick={onProject}
            >
              <Folder className="size-3" />
              Temporary task · Choose project
            </Button>
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>
        }
      />
    </div>
  )
}
