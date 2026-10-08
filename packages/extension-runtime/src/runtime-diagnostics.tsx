import { useCallback, useEffect, useState } from 'react'
import {
  runtimeBackupResponseSchema,
  runtimeDiagnosticsSchema,
  type RuntimeDiagnostics,
} from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'

export function RuntimeDiagnosticsPanel() {
  const { request, connected } = useWorkspace()
  const [status, setStatus] = useState<RuntimeDiagnostics | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const refresh = useCallback(async () => {
    const result = await request('/api/runtime/diagnostics', {}, runtimeDiagnosticsSchema)
    setStatus(result)
  }, [request])
  useEffect(() => {
    if (!connected) return
    let active = true
    void request('/api/runtime/diagnostics', {}, runtimeDiagnosticsSchema).then(
      (result) => {
        if (active) {
          setStatus(result)
          setError('')
        }
      },
      (cause) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause))
      },
    )
    return () => {
      active = false
    }
  }, [request, connected])
  const run = async (backup: boolean) => {
    setBusy(true)
    setError('')
    try {
      if (backup) await request('/api/runtime/backup', {}, runtimeBackupResponseSchema)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <article className="space-y-3 rounded-md border p-4 text-xs">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Runtime readiness & recovery</h2>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !connected}
          onClick={() => void run(false)}
        >
          Refresh
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {status && (
        <>
          <p>
            {status.ready ? 'Ready' : 'Needs attention'} · Checked{' '}
            {new Date(status.checkedAt).toLocaleString()}
          </p>
          {status.warnings.map((warning) => (
            <p key={warning} className="text-amber-600">
              {warning}
            </p>
          ))}
          <dl className="space-y-1 break-all">
            <div>
              <dt className="inline font-medium">Database: </dt>
              <dd className="inline">{status.roots.database}</dd>
            </div>
            <div>
              <dt className="inline font-medium">New worktrees: </dt>
              <dd className="inline">
                {status.roots.worktrees} ({status.roots.worktreesSource})
              </dd>
            </div>
          </dl>
          <p>
            {status.queues.queued} queued · {status.queues.paused} paused queues ·{' '}
            {status.queues.waitingQuestions} questions · {status.queues.waitingApprovals} approvals
          </p>
          {status.operations.map((operation) => (
            <p key={operation.taskId}>
              {operation.title}: {operation.state} · {Math.floor(operation.durationMs / 60_000)} min
            </p>
          ))}
          <p>
            Last task scheduler tick: {status.schedulers.tasks.lastSuccess ?? 'None'} · Automation
            tick: {status.schedulers.jobs.lastSuccess ?? 'None'}
          </p>
          <h3 className="font-medium">Database backups</h3>
          <p className="text-muted-foreground">
            Daily verified backups retain up to five copies within 512 MB. Includes conversation
            history, credentials and attachment data. Repository files need their own backup.
          </p>
          <Button
            size="sm"
            disabled={busy || !connected || status.backups.active}
            onClick={() => void run(true)}
          >
            {busy || status.backups.active ? 'Backing up…' : 'Create backup now'}
          </Button>
          {status.backups.entries.map((entry) => (
            <p key={entry.path} className="break-all">
              {new Date(entry.createdAt).toLocaleString()} · {(entry.size / 1024 / 1024).toFixed(1)}{' '}
              MB · {entry.path}
            </p>
          ))}
          <p className="text-muted-foreground">
            To restore, stop this runtime and its service, then use{' '}
            <code>dovo-server restore --backup &lt;path&gt;</code> on its computer. A pre-restore
            backup is kept. If history cannot load, use{' '}
            <code>dovo-server recovery-export --output &lt;new-directory&gt;</code> to preserve raw
            records for inspection.
          </p>
        </>
      )}
    </article>
  )
}
