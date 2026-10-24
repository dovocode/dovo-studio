import { useEffect, useRef } from 'react'
import { useApplicationState } from '@dovo/studio-core/state'
import { useWorkspace } from '@dovo/studio-core'
import {
  githubConnectionCheckSchema,
  RuntimeRequestError,
  type GithubConnectionCheck,
} from '@dovo/protocol'
import { Button } from '@dovo/studio-ui'
import { RefreshCw } from 'lucide-react'

export function GithubConnectionStatus({
  connectionId,
  repositoryId,
  automatic = false,
}: {
  connectionId?: string
  repositoryId?: string
  automatic?: boolean
}) {
  const { request, connected } = useWorkspace()
  const [result, setResult] = useApplicationState<GithubConnectionCheck | null>(null)
  const [error, setError] = useApplicationState('')
  const [busy, setBusy] = useApplicationState(false)
  const [attempt, setAttempt] = useApplicationState(0)
  const [lastVerifiedAt, setLastVerifiedAt] = useApplicationState<string | null>(null)
  const pending = useRef(false)
  useEffect(() => {
    setResult(null)
    setLastVerifiedAt(null)
  }, [request, connectionId, repositoryId])
  useEffect(() => {
    let current = true
    setError('')
    setBusy(false)
    pending.current = false
    // Opening settings verifies account identity only. Project access checks are explicit,
    // so a computer with many projects does not fan out repository requests on every visit.
    if (!connected || (repositoryId && !attempt)) return
    pending.current = true
    setBusy(true)
    void request(
      '/api/scm/connections/github/read',
      {
        connectionId,
        repositoryId,
        refresh: attempt > 0,
      },
      githubConnectionCheckSchema,
    )
      .then((value) => {
        if (current) {
          setResult(value)
          if (value.status === 'verified') setLastVerifiedAt(value.checkedAt)
        }
      })
      .catch((cause: unknown) => {
        if (current)
          setError(
            cause instanceof RuntimeRequestError && [404, 405].includes(cause.status ?? 0)
              ? 'Connection diagnostics are unavailable. Refresh connections or update this computer’s runtime.'
              : cause instanceof Error
                ? cause.message
                : String(cause),
          )
      })
      .finally(() => {
        if (current) {
          pending.current = false
          setBusy(false)
        }
      })
    return () => {
      current = false
    }
  }, [request, connected, connectionId, repositoryId, attempt])
  const status = !connected
    ? 'Computer offline · Reconnect to verify this connection.'
    : busy
      ? 'Checking GitHub connection…'
      : error ||
        (!result
          ? repositoryId
            ? 'Repository access has not been tested.'
            : 'Account has not been verified.'
          : '')
  return (
    <div className="grid gap-2 text-xs" aria-label="GitHub connection status" aria-busy={busy}>
      <p
        role={error ? 'alert' : 'status'}
        className={`min-h-4 break-words ${error ? 'text-status-warning' : 'text-muted-foreground'}`}
      >
        {status || (
          <span aria-hidden="true" className="invisible">
            Checking GitHub connection…
          </span>
        )}
      </p>
      {result && (
        <p
          role={
            connected && !busy && !error
              ? result.status === 'failed'
                ? 'alert'
                : 'status'
              : undefined
          }
          className={`break-words ${result.status === 'failed' ? 'text-status-warning' : 'text-muted-foreground'}`}
        >
          {result.login && (
            <span className="font-medium text-foreground">
              @{result.login} · {result.host}
              <br />
            </span>
          )}
          {result.repository && <span className="block">{result.repository}</span>}
          {result.message}
          <span className="mt-1 block">Checked {new Date(result.checkedAt).toLocaleString()}</span>
        </p>
      )}
      {lastVerifiedAt && (error || result?.status !== 'verified') && (
        <p className="text-muted-foreground">
          Last successful check {new Date(lastVerifiedAt).toLocaleString()}
        </p>
      )}
      {!repositoryId && (
        <p className="text-muted-foreground">Account checked in the runtime default context.</p>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="justify-self-start"
        disabled={!connected || busy}
        aria-busy={busy}
        onClick={() => {
          if (pending.current) return
          pending.current = true
          setAttempt((value) => value + 1)
        }}
      >
        <RefreshCw aria-hidden="true" className={busy ? 'motion-safe:animate-spin' : undefined} />
        {repositoryId ? 'Test project connection' : 'Test connection'}
      </Button>
      {automatic && (
        <p className="text-muted-foreground">
          Uses GitHub CLI on this computer. A project checkout can resolve a different account.
        </p>
      )}
    </div>
  )
}
