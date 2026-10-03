import { randomUUID } from '@dovo/protocol'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect } from 'react'
import { responses, useWorkspace, type Task } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'
export function RunControls({ task }: { task: Task }) {
  const { request, connected, snapshot } = useWorkspace(),
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
  const approvals = snapshot?.approvals.filter((approval) => approval.taskId === task.id) ?? []
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
      const first = document.querySelector('[data-approval-id]')
      if (first?.getAttribute('data-approval-id') !== approvals[0].id) return
      if (event.key.toLowerCase() !== 'y' && event.key.toLowerCase() !== 'n') return
      event.preventDefault()
      act('/api/approvals', { id: approvals[0].id, allow: event.key.toLowerCase() === 'y' })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [approvals, connected, busy])
  const executionHost =
    task.turns?.at(-1)?.runtimeHost ?? snapshot?.runtimeHost ?? 'the selected computer'
  if (
    connected &&
    !approvals.length &&
    !error &&
    !task.error &&
    !task.restartRecovery &&
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
      {approvals.map((approval) => (
        <div
          key={approval.id}
          data-approval-id={approval.id}
          className="mx-auto max-w-[var(--chat-max)] rounded-lg border bg-card p-3"
        >
          <p className="mb-1 text-[0.6875rem] text-muted-foreground">
            Permission request · {executionHost}
          </p>
          <p className="text-xs font-medium">{approval.title}</p>
          <pre className="my-2 max-h-40 overflow-auto whitespace-pre-wrap break-all text-[0.6875rem] text-muted-foreground">
            {approval.detail}
          </pre>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy || !connected}
              onClick={() =>
                act('/api/approvals', {
                  id: approval.id,
                  allow: true,
                })
              }
            >
              Allow once
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !connected || !/command|bash|shell/i.test(approval.title)}
              onClick={() =>
                act('/api/approvals', { id: approval.id, allow: true, remember: true })
              }
            >
              Always allow in this project
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !connected}
              onClick={() =>
                act('/api/approvals', {
                  id: approval.id,
                  allow: false,
                })
              }
            >
              Deny
            </Button>
          </div>
        </div>
      ))}
      {(error || (task.status !== 'cancelled' && task.error)) && (
        <p role="alert" className="mx-auto max-w-[var(--chat-max)] text-xs text-destructive">
          {error || task.error}
        </p>
      )}
    </div>
  )
}
