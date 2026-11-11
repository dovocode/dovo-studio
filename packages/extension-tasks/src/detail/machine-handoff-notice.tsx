import { useState } from 'react'
import { Schema } from 'effect'
import { MonitorUp } from 'lucide-react'
import {
  projectTransferActive,
  projectTransferLabel,
  projectTransferSchema,
  type ProjectTransfer,
  type Task,
} from '@dovo/protocol'
import { useStudioHost, useWorkspace } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'

/**
 * What the user can do with a thread that moves to another computer. The runtime owns the
 * outcome: cancellation unlocks the source only after the destination confirms cleanup, and a
 * committed move always wins over a later cancel.
 */
function machineHandoffStatus(
  handoff: NonNullable<Task['machineHandoff']>,
  job: ProjectTransfer | undefined,
  name: string,
) {
  if (handoff.state === 'staged')
    return {
      title: 'This thread is arriving from another computer',
      detail: 'It opens here when the source computer finishes the move.',
      canCancel: false,
      canRetry: false,
      canOpen: false,
    }
  const failed = job?.state === 'failed'
  // A moved source is durable, but the destination opens the thread only after activation.
  if (handoff.state === 'moved')
    return job?.state === 'completed'
      ? {
          title: `This thread continues on ${name}`,
          detail:
            'Open it there and send your next message. This copy is read-only and stays here for recovery.',
          canCancel: false,
          canRetry: false,
          canOpen: true,
        }
      : {
          title: `Finishing handoff to ${name}…`,
          detail: failed
            ? `${name} has the thread but has not opened it yet. Retry to finish the handoff. This copy stays read-only.`
            : `${name} opens the thread when the handoff finishes. This copy stays read-only.`,
          canCancel: false,
          canRetry: failed,
          canOpen: false,
        }
  const unconfirmed = job?.state === 'cancelled' || job?.state === 'completed'
  return {
    title: `Moving this thread to ${name}…`,
    detail: failed
      ? `Retry the move, or cancel it. Cancel unlocks this thread only after ${name} confirms that it removed its copy. If ${name} already received the thread, cancel finishes the move instead.`
      : unconfirmed
        ? `The result is not confirmed yet. This thread stays read-only until ${name} is online and confirms it.`
        : 'Messages and edits are paused while the thread moves.',
    canCancel: !!job && job.state !== 'completed',
    canRetry: failed,
    canOpen: false,
  }
}

/**
 * Replaces the composer while a thread moves, or after it moved, to another computer.
 * The source stays read-only, so two computers never run the same thread.
 */
export function MachineHandoffNotice({
  handoff,
  taskId,
}: {
  handoff: NonNullable<Task['machineHandoff']>
  taskId: string
}) {
  const store = useWorkspace()
  const host = useStudioHost()
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  // The handoff ID is the transfer job ID; it also survives later copies of this thread.
  const jobs = store.snapshot?.projectTransfers
  const job =
    jobs?.find((item) => item.id === handoff.id) ??
    jobs?.filter((item) => item.sourceTaskId === taskId).at(-1)
  const target = store.runtimes.find(
    (entry) =>
      (entry.profile.connection.runtimeId ?? entry.snapshot?.runtimeId) === handoff.targetRuntimeId,
  )
  const name = job?.targetName ?? target?.profile.name ?? 'another computer'
  const targetTaskId = handoff.targetTaskId ?? job?.targetTaskId
  const active = !!job && projectTransferActive(job)
  const status = machineHandoffStatus(handoff, job, name)
  const act = async (action: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section
      aria-label="Thread on another computer"
      className="mx-auto flex w-full max-w-[var(--chat-max)] flex-col gap-2 px-5 pb-4"
    >
      <div className="flex items-start gap-3 rounded-xl border bg-muted/40 p-3 text-xs">
        <MonitorUp className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div role="status" className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium">{status.title}</p>
          <p className="text-muted-foreground">{status.detail}</p>
          {job && handoff.state !== 'staged' && job.state !== 'completed' && (
            <p className={job.state === 'failed' ? 'text-destructive' : 'text-muted-foreground'}>
              {projectTransferLabel(job)}
            </p>
          )}
          {active && (
            <progress
              className="h-1.5 w-full"
              aria-label="Thread move progress"
              value={job.state === 'preparing' ? undefined : job.bytes}
              max={job.totalBytes || 1}
            />
          )}
          {status.canOpen && targetTaskId && !target && (
            <p className="text-muted-foreground">Pair {name} to open this thread.</p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {status.canOpen && targetTaskId && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !target}
              onClick={() =>
                void act(async () => {
                  if (!target) throw new Error(`Pair ${name} to open this thread.`)
                  await store.switchRuntime(target.profile.id)
                  host.navigate({ viewId: 'tasks', entityId: targetTaskId })
                })
              }
            >
              Open on {name}
            </Button>
          )}
          {status.canRetry && job && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !store.connected}
              onClick={() =>
                void act(() =>
                  store.request(
                    '/api/scm/project-transfer/retry',
                    { id: job.id },
                    projectTransferSchema,
                  ),
                )
              }
            >
              Retry move
            </Button>
          )}
          {status.canCancel && job && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || !store.connected}
              onClick={() =>
                void act(() =>
                  store.request(
                    '/api/scm/project-transfer/cancel',
                    { id: job.id },
                    Schema.Struct({ ok: Schema.Boolean }),
                  ),
                )
              }
            >
              Cancel move
            </Button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="px-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
