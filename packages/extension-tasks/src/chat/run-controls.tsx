import { useApplicationState } from '@dovo/studio-core/state'
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
  const approvals = snapshot?.approvals.filter((approval) => approval.taskId === task.id) ?? []
  const executionHost =
    task.turns?.at(-1)?.runtimeHost ?? snapshot?.runtimeHost ?? 'the selected computer'
  if (connected && !approvals.length && !error && !task.error && !task.restartRecovery) return null
  return (
    <div className="shrink-0 space-y-2 px-5 pb-2">
      {!connected && (
        <p role="status" className="mx-auto max-w-3xl text-xs text-muted-foreground">
          {executionHost} is offline. Your draft is saved here.
        </p>
      )}
      {task.restartRecovery &&
        task.status !== 'running' &&
        !task.archived &&
        !snapshot?.runs.some((run) => run.taskIds.includes(task.id)) && (
          <div className="mx-auto max-w-3xl">
            <Button
              size="sm"
              disabled={busy || !connected}
              onClick={() => act('/api/tasks/run', { id: task.id })}
            >
              {task.runPhase === 'finalizing' ? 'Retry saving changes' : 'Resume task'}
            </Button>
          </div>
        )}
      {approvals.map((approval) => (
        <div key={approval.id} className="mx-auto max-w-3xl rounded-lg border bg-card p-3">
          <p className="mb-1 text-[11px] text-muted-foreground">
            Permission request · {executionHost}
          </p>
          <p className="text-xs font-medium">{approval.title}</p>
          <pre className="my-2 max-h-40 overflow-auto whitespace-pre-wrap break-all text-[11px] text-muted-foreground">
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
      {(error || task.error) && (
        <p role="alert" className="mx-auto max-w-3xl text-xs text-destructive">
          {error || task.error}
        </p>
      )}
    </div>
  )
}
