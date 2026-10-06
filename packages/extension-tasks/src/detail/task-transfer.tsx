import { useEffect, useState } from 'react'
import { ArrowRightLeft } from 'lucide-react'
import { useWorkspace, useStudioHost, type Task } from '@dovo/studio-core'
import {
  randomUUID,
  resolveTaskAgent,
  transferOptionsSchema,
  transferPrepareSchema,
  moveTaskToComputer,
  abortTaskTransfer,
  type TransferPrepare,
} from '@dovo/protocol'
import { Button, Dialog, DialogContent, DialogTitle, DialogDescription } from '@dovo/studio-ui'

export function TaskTransfer({
  task,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: {
  task: Task
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
}) {
  const store = useWorkspace(),
    host = useStudioHost()
  const [localOpen, setLocalOpen] = useState(false)
  const open = controlledOpen ?? localOpen
  const setOpen = onOpenChange ?? setLocalOpen
  const [selected, setSelected] = useState('')
  const [options, setOptions] = useState<typeof transferOptionsSchema.Type | null>(null)
  const [sourceIdentity, setSourceIdentity] = useState('')
  const [projectId, setProjectId] = useState(''),
    [agentId, setAgentId] = useState('')
  const [attempt, setAttempt] = useState<TransferPrepare | null>(null)
  const [mode, setMode] = useState<'native' | 'replay'>('native')
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const profiles = store.runtimeRegistry.profiles.filter(
    (profile) => profile.id !== store.activeRuntimeId,
  )
  const profile = profiles.find((item) => item.id === selected)
  const agent = resolveTaskAgent(task, store.workspace.agents)
  const repository = store.workspace.repositories.find((item) => item.id === task.repositoryId)
  const candidates =
    options?.projects.filter((project) => project.identity === sourceIdentity) ?? []
  const destination =
    candidates.find((project) => project.id === projectId) ??
    (candidates.length === 1 ? candidates[0] : undefined)
  const agents =
    destination?.agents.filter(
      (item) => item.provider === agent?.provider && item.model === agent?.model,
    ) ?? []
  const destinationAgent =
    agents.find((item) => item.id === agentId) ?? (agents.length === 1 ? agents[0] : undefined)
  const pending = task.transfer?.direction === 'out'
  const sealed = pending && task.transfer?.state === 'sealed'
  const source = store.runtimeRegistry.profiles.find((item) => item.id === store.activeRuntimeId)
  const sourceCall: typeof store.request = (path, input, schema, method) =>
    source
      ? store.readRuntime(source, path, input, schema, method)
      : store.request(path, input, schema, method)
  useEffect(() => {
    if (!open) return
    let alive = true
    void sourceCall('/api/tasks/transfer/options', {}, transferOptionsSchema)
      .then((value) => {
        if (alive)
          setSourceIdentity(
            value.projects.find((item) => item.id === task.repositoryId)?.identity ?? '',
          )
      })
      .catch((cause) => {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause))
      })
    if (pending && task.transfer)
      void sourceCall('/api/tasks/transfer/read', { id: task.transfer.id }, transferPrepareSchema)
        .then((input) => {
          if (!alive) return
          setAttempt(input)
          setMode(input.mode)
          setProjectId(input.target.repositoryId)
          setAgentId(input.target.agentId)
          setSelected(
            profiles.find((item) => item.connection.address === input.target.address)?.id ?? '',
          )
        })
        .catch((cause) => {
          if (alive) setError(cause instanceof Error ? cause.message : String(cause))
        })
    return () => {
      alive = false
    }
  }, [open, task.transfer?.id])
  useEffect(() => {
    setOptions(null)
    if (!open || !profile) return
    let alive = true
    void store
      .readRuntime(profile, '/api/tasks/transfer/options', {}, transferOptionsSchema)
      .then((value) => {
        if (alive) setOptions(value)
      })
      .catch((cause) => {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      alive = false
    }
  }, [open, profile?.id])
  const act = async (operation: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await operation()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
      await store
        .refreshRuntimes()
        .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
    }
  }
  const move = () =>
    act(async () => {
      if (!profile || !store.connection) throw new Error('Choose a paired destination computer.')
      if (attempt && options?.runtimeId !== attempt.target.runtimeId)
        throw new Error('Choose the original destination computer to complete this move.')
      const input =
        attempt ??
        (options && destination && destinationAgent
          ? {
              id: randomUUID(),
              taskId: task.id,
              sourceAddress: store.connection.address,
              target: {
                runtimeId: options.runtimeId,
                address: profile.connection.address,
                repositoryId: destination.id,
                agentId: destinationAgent.id,
                taskId: randomUUID(),
              },
              mode,
            }
          : null)
      if (!input) throw new Error('The destination needs the same Git project, provider and model.')
      setAttempt(input)
      await store.flush()
      const result = await moveTaskToComputer(
        sourceCall,
        (path, input, schema) => store.readRuntime(profile, path, input, schema),
        input,
      )
      await store.refreshRuntimes()
      await store.switchRuntime(profile.id)
      setOpen(false)
      host.navigate({ viewId: 'tasks', entityId: result.id })
    })
  const cancel = () =>
    act(async () => {
      if (!profile || !attempt) throw new Error('Reconnect the destination to cancel this move.')
      if (options?.runtimeId !== attempt.target.runtimeId)
        throw new Error('Choose the original destination computer to cancel this move.')
      await abortTaskTransfer(
        sourceCall,
        (path, input, schema) => store.readRuntime(profile, path, input, schema),
        attempt,
      )
      setAttempt(null)
      setOpen(false)
    })
  const openDestination = async () => {
    const target = store.runtimeRegistry.profiles.find(
      (item) => item.connection.address === task.transfer?.peerAddress,
    )
    if (!target || !task.transfer) {
      setError('Pair the destination computer to open this task.')
      return
    }
    await store.switchRuntime(target.id)
    host.navigate({ viewId: 'tasks', entityId: task.transfer.peerTaskId })
  }
  if (sealed)
    return (
      <div className="flex flex-wrap items-center gap-2 px-2 py-1 text-xs">
        <span>This task is locked for the destination computer.</span>
        <Button size="sm" variant="outline" onClick={() => void act(openDestination)}>
          Open destination
        </Button>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          Complete move
        </Button>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {dialog()}
      </div>
    )
  function dialog() {
    return (
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogTitle>{pending ? 'Complete the move' : 'Move to computer'}</DialogTitle>
          <DialogDescription>
            The conversation and files move into a new worktree at the same commit. This computer
            keeps read-only history.
          </DialogDescription>
          <label className="flex flex-col gap-1 text-sm">
            Computer
            <select
              aria-label="Computer"
              className="rounded-md border bg-background p-2"
              value={selected}
              disabled={busy}
              onChange={(event) => {
                setSelected(event.target.value)
                setProjectId('')
                setAgentId('')
                setError('')
              }}
            >
              <option value="">Choose a paired computer</option>
              {profiles.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          {options && !candidates.length && (
            <p className="text-xs">
              No matching Git project. Add the same project on this computer.
            </p>
          )}
          {candidates.length > 0 && (
            <label className="flex flex-col gap-1 text-sm">
              Project
              <select
                aria-label="Project"
                className="rounded-md border bg-background p-2"
                value={destination?.id ?? ''}
                disabled={busy || !!attempt}
                onChange={(event) => {
                  setProjectId(event.target.value)
                  setAgentId('')
                }}
              >
                <option value="">Choose a project</option>
                {candidates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {destination && (
            <label className="flex flex-col gap-1 text-sm">
              Agent
              <select
                aria-label="Agent"
                className="rounded-md border bg-background p-2"
                value={destinationAgent?.id ?? ''}
                disabled={busy || !!attempt}
                onChange={(event) => setAgentId(event.target.value)}
              >
                <option value="">Choose the same provider and model</option>
                {agents.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm">
            Agent context
            <select
              aria-label="Agent context"
              className="rounded-md border bg-background p-2"
              value={mode}
              disabled={busy || !!attempt}
              onChange={(event) => setMode(event.target.value === 'replay' ? 'replay' : 'native')}
            >
              <option value="native">Preserve native session (experimental, Codex / Claude)</option>
              <option value="replay">Start a new session with conversation replay</option>
            </select>
          </label>
          <p className="text-xs text-muted-foreground">
            Native continuation requires the same provider version. Replay may lose tool history and
            compacted context. Commit or stash changes and close task terminals before moving.
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            {attempt && !sealed && (
              <Button variant="outline" disabled={busy || !profile} onClick={() => void cancel()}>
                Cancel move
              </Button>
            )}
            <Button
              disabled={
                busy ||
                !store.connected ||
                !profile ||
                (!attempt && !destinationAgent) ||
                task.transfer?.state === 'aborting'
              }
              onClick={() => void move()}
            >
              {busy ? 'Moving…' : attempt ? 'Retry move' : 'Move task'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    )
  }
  return (
    <>
      {!hideTrigger && (
        <Button
          variant="ghost"
          size="sm"
          disabled={
            !store.connected ||
            task.status === 'running' ||
            task.status === 'draft' ||
            !!task.queue?.length ||
            !profiles.length ||
            !!repository?.kind ||
            !task.messages.length
          }
          onClick={() => setOpen(true)}
        >
          <ArrowRightLeft size={14} /> {pending ? 'Complete move…' : 'Move to computer…'}
        </Button>
      )}
      {dialog()}
    </>
  )
}
