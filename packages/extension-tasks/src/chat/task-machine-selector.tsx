import { Schema } from 'effect'
import { useApplicationState } from '@dovo/studio-core/state'
import { useWorkspace, useStudioHost } from '@dovo/studio-core'
import { canChangeTaskCheckout, taskMachineDraft, taskSchema, type Task } from '@dovo/protocol'
import { Button, DropdownMenu } from '@dovo/studio-ui'
import { Monitor, ChevronDown } from 'lucide-react'
import { taskSources } from '../task-collection'

export function TaskMachineSelector({
  task,
  disabled,
  onMoving,
}: {
  task: Task
  disabled: boolean
  onMoving: (moving: boolean) => void
}) {
  const store = useWorkspace()
  const host = useStudioHost()
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const sources = taskSources(store)
  const repository = store.workspace.repositories.find((repo) => repo.id === task.repositoryId)
  const identity = repository?.gitIdentity
  const targets = sources.flatMap((source) =>
    source.workspace.repositories
      .filter(
        (repo) =>
          !!identity &&
          repo.gitIdentity === identity &&
          (source.runtimeId !== store.activeRuntimeId || repo.id === task.repositoryId),
      )
      .map((repo) => ({ source, repository: repo })),
  )
  const machineCount = new Set(targets.map(({ source }) => source.runtimeId)).size
  const current = sources.find((source) => source.runtimeId === store.activeRuntimeId)
  const editable = canChangeTaskCheckout(task) && !task.archivedAt
  return (
    <div className="relative">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="h-6 gap-1 px-2 text-[0.625rem] font-normal"
            disabled={disabled || !editable || busy}
            title={`Runs on ${current?.name ?? 'this machine'}`}
            aria-label="Task machine"
          >
            <Monitor className="size-3" />
            <span className="max-w-28 truncate">{current?.name ?? 'This machine'}</span>
            {machineCount > 1 && <span className="text-muted-foreground">+{machineCount - 1}</span>}
            {editable && <ChevronDown className="size-3" />}
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            side="top"
            className="z-50 max-w-80 rounded-xl border bg-popover p-2 text-popover-foreground shadow-xl"
          >
            <DropdownMenu.Label className="px-2 py-1 text-xs text-muted-foreground">
              Run on · starts only after your first prompt
            </DropdownMenu.Label>
            {targets.map(({ source, repository: target }) => (
              <DropdownMenu.Item
                key={`${source.runtimeId}:${target.id}`}
                className="cursor-default rounded-md px-2 py-2 text-xs outline-none focus:bg-accent data-[disabled]:opacity-40"
                disabled={!source.online || busy || source.runtimeId === store.activeRuntimeId}
                onSelect={() => {
                  const profile = store.runtimeRegistry.profiles.find(
                    (p) => p.id === source.runtimeId,
                  )
                  const origin = store.runtimeRegistry.profiles.find(
                    (p) => p.id === store.activeRuntimeId,
                  )
                  if (!profile || !identity) return
                  setBusy(true)
                  onMoving(true)
                  setError('')
                  void (async () => {
                    await store.flush()
                    const draft = taskMachineDraft(task, target, source.snapshot?.defaults)
                    await store.readRuntime(
                      profile,
                      '/api/tasks/draft-receive',
                      { task: draft, gitIdentity: identity },
                      taskSchema,
                    )
                    const sourceRequest: typeof store.request = origin
                      ? (path, input, schema, method) =>
                          store.readRuntime(origin, path, input, schema, method)
                      : store.request
                    await sourceRequest(
                      '/api/tasks/draft-moved',
                      {
                        id: task.id,
                        repositoryId: task.repositoryId,
                        draft: task.draft,
                        gitIdentity: identity,
                      },
                      Schema.Struct({ ok: Schema.Boolean }),
                    )
                    await store.refreshRuntimes()
                    await store.switchRuntime(profile.id)
                    host.navigate({ viewId: 'tasks', entityId: task.id })
                  })()
                    .catch((error: unknown) => setError(String(error)))
                    .finally(() => {
                      setBusy(false)
                      onMoving(false)
                    })
                }}
              >
                {source.name}
                {!source.online
                  ? ' · Offline'
                  : source.runtimeId === store.activeRuntimeId
                    ? ' · Current'
                    : ''}
                <span className="block truncate text-[0.625rem] text-muted-foreground">
                  {target.path}
                </span>
              </DropdownMenu.Item>
            ))}
            {targets.length < 2 && (
              <p className="max-w-64 px-2 py-2 text-xs text-muted-foreground">
                No other saved machine has this Git repository checked out.
              </p>
            )}
            <p className="max-w-64 px-2 py-1 text-[0.625rem] text-muted-foreground">
              Draft text moves with you. The destination’s task defaults apply. The original is
              archived after transfer.
            </p>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {error && (
        <p role="alert" className="max-w-72 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
