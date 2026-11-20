import { useInterfaceText } from '@dovo/studio-core/interface-language'
import {
  runtimeComputerName,
  resolveThreadRuntime,
  approvalActions,
  taskInputVisible,
  taskRemoteHumanInputs,
  taskFailureVersion,
} from '@dovo/protocol'
import { randomUUID } from '@dovo/protocol'
import { useApplicationState } from '@dovo/studio-core/state'
import { useScopedError } from '@dovo/studio-core/scoped-error'
import { useRef } from 'react'
import { useApprovalShortcuts } from '@dovo/studio-ui/human-input-shortcuts'
import { responses, useWorkspace, useStudioHost, type Task } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'
import { ApprovalDetails } from './approval-details'
export function RunControls({ task }: { task: Task }) {
  const uiText = useInterfaceText()

  const host = useStudioHost()
  const remoteInputs = taskRemoteHumanInputs(task)
  const { request, connected, snapshot, runtimes, runtimeRegistry, activeRuntimeId } =
      useWorkspace(),
    [error, setError] = useApplicationState(''),
    [busy, setBusy] = useApplicationState(false)
  const [retryError, setRetryError] = useScopedError(
    task.status === 'failed'
      ? JSON.stringify([activeRuntimeId, task.id, taskFailureVersion(task)])
      : undefined,
  )
  const act = (path: string, input: unknown, reportError: (message: string) => void = setError) => {
    if (!connected || busy) return
    setError('')
    if (reportError !== setError) reportError('')
    setBusy(true)
    return request(path, input, responses.ok)
      .catch((error: unknown) =>
        reportError(error instanceof Error ? error.message : String(error)),
      )
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
  const controls = useRef<HTMLDivElement>(null)
  useApprovalShortcuts({
    root: controls,
    disabled: !connected || busy || !approvals.length,
    onAnswer: (id, allow) => {
      if (approvals.some((approval) => approval.id === id))
        return act('/api/approvals', { id, allow, decision: allow ? 'approve' : 'deny' })
    },
  })
  const executionHost = runtimeComputerName({
    profile: runtimes.find((entry) => entry.profile.id === activeRuntimeId)?.profile,
    snapshot: { runtimeHost: task.turns?.at(-1)?.runtimeHost ?? snapshot?.runtimeHost },
  })
  const alert =
    error || retryError || (task.status !== 'cancelled' || task.activeRunId ? task.error : '')
  if (
    connected &&
    !approvals.length &&
    !remoteInputs.length &&
    !alert &&
    !task.restartRecovery &&
    task.status !== 'failed' &&
    task.status !== 'cancelled'
  )
    return null
  return (
    <div
      ref={controls}
      className="shrink-0 space-y-2 px-5 pb-2"
      data-human-input={approvals.length ? 'approval' : undefined}
      data-human-input-task={task.id}
    >
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
              {task.runPhase === 'finalizing' ? 'Retry saving changes' : 'Resume thread'}
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
            {uiText('Continue')}
          </Button>
        </div>
      )}
      {remoteInputs.map((input) => (
        <div
          key={JSON.stringify([input.runtimeIdentity, input.id])}
          className="mx-auto max-w-[var(--chat-max)] rounded-lg border bg-card p-3"
        >
          <p className="text-xs text-muted-foreground">
            {input.kind === 'approval' ? uiText('Permission request') : uiText('Input request')} ·
            For child thread: {input.threadTitle} · {input.computerName}
          </p>
          <p className="py-1 text-xs font-medium">{input.title}</p>
          <Button
            size="sm"
            disabled={!host.openThread}
            onClick={() => {
              const owner = resolveThreadRuntime(
                { runtimeId: input.runtimeId, runtimeIdentity: input.ownerRuntimeIdentity },
                runtimeRegistry.profiles,
                runtimes,
              )
              host.openThread?.({
                runtimeId: owner?.id ?? input.runtimeId,
                runtimeIdentity: owner ? input.ownerRuntimeIdentity : input.runtimeIdentity,
                threadId: owner ? input.ownerTaskId : input.taskId,
                title: input.threadTitle,
              })
            }}
          >
            Review request
          </Button>
        </div>
      ))}
      {approvals.map((approval) => (
        <div
          key={approval.id}
          data-studio-human-only
          className="mx-auto max-w-[var(--chat-max)] rounded-lg border bg-card p-3"
        >
          <p
            data-request-kind="approval"
            data-request-id={approval.id}
            tabIndex={-1}
            className="text-xs font-medium"
          >
            {approval.title}
          </p>
          <div
            data-approval-id={approval.id}
            tabIndex={0}
            aria-label={approval.title}
            aria-keyshortcuts="Y N Enter"
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
                    <kbd aria-hidden="true" className="ml-1 text-[0.625rem]">
                      {action.decision === 'approve' ? 'Y / Enter' : 'N'}
                    </kbd>
                  ) : null}
                </Button>
              ))}
            </div>
          </div>
        </div>
      ))}
      {(alert || task.status === 'failed') && (
        <div className="mx-auto max-w-[var(--chat-max)] space-y-2 rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2.5">
          {alert && (
            <p role="alert" className="break-words text-xs text-destructive">
              {alert}
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
                  onClick={() => act('/api/tasks/retry-failed', { id: task.id }, setRetryError)}
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
