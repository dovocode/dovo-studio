import { useEffect, useRef, useState } from 'react'
import {
  serverUpdateStatusSchema,
  type ServerUpdateStatus,
  type RuntimeProfile,
} from '@dovo/protocol'
import { runtimeRequest } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'

const size = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`

export function ServerUpdateControl({
  profile,
  version,
  onComplete,
}: {
  profile: RuntimeProfile
  version: string
  onComplete: () => Promise<void>
}) {
  const [status, setStatus] = useState<ServerUpdateStatus>({ status: 'idle' })
  const completed = useRef(false)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    const poll = () => {
      void runtimeRequest(
        profile.connection,
        profile.connection.address,
        '/api/runtime/update/status',
        undefined,
        serverUpdateStatusSchema,
        'GET',
        5000,
      ).then(
        (next) => {
          if (!active) return
          setStatus(next)
          if (next.status === 'complete' && next.version === version && !completed.current) {
            completed.current = true
            void onCompleteRef.current()
          }
        },
        () => {
          /* The connection is expected to drop while the server restarts. */
        },
      )
    }
    poll()
    const timer = setInterval(poll, 2000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [profile.connection.address, profile.connection.token, version])
  const running =
    status.version === version && ['queued', 'downloading', 'installing'].includes(status.status)
  return (
    <div className="mt-2 space-y-1">
      {running ? (
        <div role="status" aria-live="polite" className="text-xs text-muted-foreground">
          {status.status === 'queued'
            ? 'Preparing update…'
            : status.status === 'installing'
              ? 'Installing and restarting…'
              : `Downloading ${Math.round(status.progress ?? 0)}%`}
          {status.status === 'downloading' && !!status.total && (
            <span>
              {' '}
              · {size(status.transferred ?? 0)} / {size(status.total)}
            </span>
          )}
          {status.status === 'downloading' && (
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary"
                style={{ width: `${Math.min(100, Math.max(0, status.progress ?? 0))}%` }}
              />
            </div>
          )}
        </div>
      ) : status.version === version && status.status === 'complete' ? (
        <p role="status" className="text-xs text-emerald-400">
          Server updated. Reconnecting…
        </p>
      ) : (
        <Button
          size="sm"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            setError('')
            void runtimeRequest(
              profile.connection,
              profile.connection.address,
              '/api/runtime/update/start',
              { version },
              serverUpdateStatusSchema,
            )
              .then(setStatus, (cause: unknown) =>
                setError(cause instanceof Error ? cause.message : String(cause)),
              )
              .finally(() => setBusy(false))
          }}
        >
          {busy ? 'Starting update…' : `Update server to ${version}`}
        </Button>
      )}
      {status.version === version && status.status === 'error' && (
        <p role="alert" className="text-xs text-destructive">
          {status.error ?? 'Server update failed.'}
        </p>
      )}
      {!!error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
