import { useApplicationState } from '@dovo/studio-core/state'
import { decode } from '@dovo/protocol'
import {
  defaultTaskHarness,
  lockedTaskProvider,
  providers,
  resolveTaskAgent,
  taskHarnessSchema,
  updateTask,
  supportsAccess,
  useWorkspace,
  type Task,
} from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@dovo/studio-ui'
import { HarnessFields } from './harness-fields'
export function HarnessDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const { workspace, setWorkspace, flush } = useWorkspace()
  const providerLock = lockedTaskProvider(task, workspace.agents)
  const [value, setValue] = useApplicationState(() => {
    const agent = resolveTaskAgent(task, workspace.agents)
    return agent ? decode(taskHarnessSchema, agent) : defaultTaskHarness(providerLock ?? 'codex')
  })
  const [busy, setBusy] = useApplicationState(false),
    [error, setError] = useApplicationState('')
  const save = async () => {
    if (busy || task.status === 'running') return
    setBusy(true)
    setError('')
    try {
      setWorkspace((workspace) =>
        updateTask(workspace, task.id, (current) => {
          if (current.status === 'running')
            throw new Error('Stop the current turn before changing its model.')
          const provider = lockedTaskProvider(current, workspace.agents)
          if (provider && value.provider !== provider)
            throw new Error(
              `This conversation uses ${providers[provider].short}. Start a new task to use another provider.`,
            )
          return {
            ...current,
            harness: value,
            agentId: '',
            agentOverrides: undefined,
          }
        }),
      )
      await flush()
      onClose()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Task harness</DialogTitle>
          <DialogDescription>
            Model, reasoning and access for this task. Saved agents stay unchanged.
          </DialogDescription>
        </DialogHeader>
        <fieldset className="grid gap-3" disabled={busy || task.status === 'running'}>
          <HarnessFields value={value} onChange={setValue} lockedProvider={providerLock} />
          <Button
            disabled={
              !supportsAccess(value.provider, value.permission) ||
              (!!providerLock && value.provider !== providerLock)
            }
            onClick={() => void save()}
          >
            Save harness
          </Button>
        </fieldset>
        {task.status === 'running' && (
          <p className="text-xs text-muted-foreground">
            Stop the current turn to change its harness.
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
