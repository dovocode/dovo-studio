import {
  runtimeComputerName,
  approvalActions,
  taskInputVisible,
  taskRemoteHumanInputs,
} from '@dovo/protocol'
import { randomUUID } from '@dovo/protocol'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect } from 'react'
import { responses, useWorkspace, useStudioHost, type Task } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'
import { ApprovalDetails } from './approval-details'
export function RunControls({ task }: { task: Task }) {
  const host = useStudioHost()
  const remoteInputs = taskRemoteHumanInputs(task)
  const { request, connected, snapshot, runtimes, activeRuntimeId } = useWorkspace(),
    [error, setError] = useApplicationState(''),
    [busy, setBusy] = useApplicationState(false)
  const act = (path: string, input: unknown) => {
    if (!connected || busy) return
    setError('')
    setBusy(true)
    void request(path, input, responses.ok)
      .catch((error) => setError(String(error)))
      .finally(() => setBusy(false))
  }
  const continueStopped = () => {
    if (!connected || busy) return
    setError('')
    setBusy(true)
    void (async () => {
      if (!task.queue?.length)
        await request(
          '/api/tasks/message',
          {
            id: task.id,
            messageId: randomUUID(),
            text: 'Continue from where you stopped.',
            attachmentIds: [],
          },
          responses.ok,
        )
      await request('/api/tasks/queue', { id: task.id, action: 'resume' }, responses.ok)
    })()
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false))
  }
  const approvals =
    snapshot?.approvals.filter((approval) =>
      taskInputVisible(snapshot.workspace.tasks, task.id, approval),
    ) ?? []
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !connected ||
        busy ||
        !approvals.length ||
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        !(event.target instanceof Element) ||
        event.target.closest(
          'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]',
        )
      )
        return
      const card = event.target.closest('[data-approval-id]')
      const approval = approvals.find((item) => item.id === card?.getAttribute('data-approval-id'))
      if (!approval) return
      if (event.key.toLowerCase() !== 'y' && event.key.toLowerCase() !== 'n') return
      event.preventDefault()
      act('/api/approvals', { id: approval.id, allow: event.key.toLowerCase() === 'y' })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [approvals, connected, busy])
  const executionHost = runtimeComputerName({
    profile: runtimes.find((entry) => entry.profile.id === activeRuntimeId)?.profile,
    snapshot: { runtimeHost: task.turns?.at(-1)?.runtimeHost ?? snapshot?.runtimeHost },
  })
  if (
    connected &&
    !approvals.length &&
    !remoteInputs.length &&
    !error &&
    !task.error &&
    !task.restartRecovery &&
    task.status !== 'failed' &&
    task.status !== 'cancelled'
  )
    return null
  return (
    <div className="shrink-0 space-y-2 px-5 pb-2">
      {!connected && (
        <p role="status" className="mx-auto max-w-[var(--chat-max)] text-xs text-muted-foreground">
          {executionHost} is offline. Your draft is saved here.
        </p>
      )}
      {task.restartRecovery &&
        task.status !== 'running' &&
        !task.archived &&
        !snapshot?.runs.some((run) => run.taskIds.includes(task.id)) && (
          <div className="mx-auto max-w-[var(--chat-max)]">
            <Button
              size="sm"
              disabled={busy || !connected}
              onClick={() => act('/api/tasks/run', { id: task.id })}
            >
              {task.runPhase === 'finalizing' ? 'Retry saving changes' : 'Resume task'}
            </Button>
          </div>
        )}
      {task.status === 'cancelled' && !task.archived && !task.restartRecovery && (
        <div className="mx-auto flex max-w-[var(--chat-max)] items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/60 px-3 py-2">
          <p className="text-xs text-muted-foreground">
            Stopped ·{' '}
            {task.queue?.length
              ? `${task.queue.length} queued ${task.queue.length === 1 ? 'message' : 'messages'} ready`
              : 'continue with a follow-up'}
          </p>
          <Button size="sm" disabled={busy || !connected} onClick={continueStopped}>
            Continue
          </Button>
        </div>
      )}
      {remoteInputs.map((input) => (
        <div
          key={JSON.stringify([input.runtimeIdentity, input.id])}
          className="mx-auto max-w-[var(--chat-max)] rounded-lg border bg-card p-3"
        >
          <p className="text-xs text-muted-foreground">
            {input.kind === 'approval' ? 'Permission request' : 'Question'} · For child thread:{' '}
            {input.threadTitle} · {input.computerName}
          </p>
          <p className="py-1 text-xs font-medium">{input.title}</p>
          <Button
            size="sm"
            disabled={!host.openThread}
            onClick={() =>
              host.openThread?.({
                runtimeId: input.runtimeId,
                runtimeIdentity: input.runtimeIdentity,
                threadId: input.taskId,
                title: input.threadTitle,
              })
            }
          >
            Review request
          </Button>
        </div>
      ))}
      {approvals.map((approval) => (
        <div
          key={approval.id}
          data-approval-id={approval.id}
          tabIndex={0}
          aria-keyshortcuts="Y N"
          data-studio-human-only
          className="mx-auto max-w-[var(--chat-max)] rounded-lg border bg-card p-3"
        >
          <p className="mb-1 text-[0.6875rem] text-muted-foreground">
            Permission request · {executionHost}
            {approval.taskId !== task.id && (
              <>
                {' '}
                · For child thread:{' '}
                {snapshot?.workspace.tasks.find((child) => child.id === approval.taskId)?.title ??
                  approval.taskId}
              </>
            )}
          </p>
          <p className="text-xs font-medium">{approval.title}</p>
          <ApprovalDetails key={approval.id} detail={approval.detail} />
          <div className="flex flex-wrap gap-2">
            {approvalActions(approval).map((action) => (
              <Button
                key={action.decision}
                size="sm"
                variant={action.decision === 'approve' ? 'default' : 'outline'}
                disabled={busy || !connected}
                onClick={() =>
                  act('/api/approvals', {
                    id: approval.id,
                    allow: action.decision !== 'deny',
                    decision: action.decision,
                  })
                }
              >
                {action.label}
                {action.decision === 'approve' || action.decision === 'deny' ? (
                  <kbd aria-hidden="true" className="ml-1 text-[0.625rem] opacity-70">
                    {action.decision === 'approve' ? 'Y' : 'N'}
                  </kbd>
                ) : null}
              </Button>
            ))}
          </div>
        </div>
      ))}
      {(error || (task.status !== 'cancelled' && task.error) || task.status === 'failed') && (
        <div className="mx-auto max-w-[var(--chat-max)] space-y-2 rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2.5">
          {(error || (task.status !== 'cancelled' && task.error)) && (
            <p role="alert" className="break-words text-xs text-destructive">
              {error || task.error}
            </p>
          )}
          {task.status === 'failed' &&
            !task.archived &&
            !task.archivedAt &&
            !task.restartRecovery && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    !connected ||
                    busy ||
                    !!task.activeRunId ||
                    !!snapshot?.runs.some((run) => run.taskIds.includes(task.id))
                  }
                  onClick={() => act('/api/tasks/retry-failed', { id: task.id })}
                >
                  {busy ? 'Retrying…' : 'Retry'}
                </Button>
                <span className="text-[0.6875rem] text-muted-foreground">
                  Current files are kept. Queued messages stay paused.
                </span>
              </div>
            )}
        </div>
      )}
    </div>
  )
}
