import { useEffect } from 'react'
import { Effect, Schema } from 'effect'
import { decode, decodeResult, mutableStruct } from '@dovo/protocol'
import { clientTaskScope, connectionSchema, useWorkspace } from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import { Button } from '@dovo/studio-ui'
const statusSchema = mutableStruct({
  local: Schema.Boolean,
  host: Schema.String,
  port: Schema.Number,
  canChange: Schema.Boolean,
})
const bridgeSchema = mutableStruct({
  dovo: mutableStruct({
    runtimeNetwork: Schema.Unknown.pipe(
      Schema.filter(
        (value): value is (address: string, enabled?: boolean, port?: number) => Promise<unknown> =>
          typeof value === 'function',
      ),
    ),
    runtimeConnection: Schema.Unknown.pipe(
      Schema.filter((value): value is () => Promise<unknown> => typeof value === 'function'),
    ),
  }),
})
export function DesktopNetwork({ onChanged }: { onChanged: (moved: boolean) => Promise<void> }) {
  const { connection, connect, activeRuntimeId } = useWorkspace()
  const [status, setStatus] = useApplicationState<Schema.Schema.Type<typeof statusSchema> | null>(
    null,
  )
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const [portInput, setPortInput] = useApplicationState('')
  useEffect(() => {
    setStatus(null)
    const bridge = decodeResult(bridgeSchema, window)
    if (!connection || !bridge.success) return
    const scope = clientTaskScope()
    void scope.run(
      Effect.tryPromise({
        try: async () => {
          const next = decode(
            statusSchema,
            await bridge.data.dovo.runtimeNetwork(connection.address),
          )
          setStatus(next)
          setPortInput(String(next.port))
        },
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      }).pipe(Effect.catchAll((cause) => Effect.sync(() => setError(cause.message)))),
    )
    return () => {
      void scope.stop()
    }
  }, [connection])
  if (!status?.local || !connection)
    return error ? (
      <p role="alert" className="text-xs text-destructive">
        Could not check local network access. {error}
      </p>
    ) : null
  const enabled = !['localhost', '127.0.0.1', '::1', '[::1]'].includes(status.host)
  const apply = (expose: boolean) => {
    const port = Number(portInput)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError('Choose a port between 1 and 65535.')
      return
    }
    const bridge = decodeResult(bridgeSchema, window)
    if (!bridge.success) return
    setBusy(true)
    setError('')
    void Effect.runPromise(
      Effect.tryPromise({
        try: async () => {
          const next = decode(
            statusSchema,
            await bridge.data.dovo.runtimeNetwork(connection.address, expose, port),
          )
          const latest = decode(connectionSchema, await bridge.data.dovo.runtimeConnection())
          const moved = latest.address !== connection.address
          if (moved) {
            if (!activeRuntimeId) throw new Error('The active local connection was not found')
            await connect(latest, undefined, activeRuntimeId)
          }
          setStatus(next)
          setPortInput(String(next.port))
          await onChanged(moved)
        },
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      }).pipe(
        Effect.catchAll((cause) => Effect.sync(() => setError(cause.message))),
        Effect.ensuring(Effect.sync(() => setBusy(false))),
      ),
    )
  }
  return (
    <div className="space-y-2 rounded border bg-muted/30 p-3">
      <details open>
        <summary className="cursor-pointer text-sm font-medium">
          {enabled ? 'LAN / VPN connections enabled' : 'Connections limited to this Mac'}
        </summary>
        <p className="mt-2 text-xs text-muted-foreground">
          Listening on {status.host}:{status.port}. Phones need LAN or VPN access. Pairing and
          device tokens are always required; HTTP is supported.
        </p>
        {status.canChange ? (
          <>
            <p className="text-xs text-muted-foreground">
              Changing this restarts the runtime and briefly disconnects clients. Finish or stop
              running tasks first.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-muted-foreground">
                Port
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={portInput}
                  disabled={busy}
                  onChange={(event) => setPortInput(event.target.value)}
                  className="mt-1 block h-8 w-24 rounded border border-input bg-background px-2 text-sm text-foreground"
                />
              </label>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || portInput === String(status.port)}
                onClick={() => apply(enabled)}
              >
                {busy ? 'Restarting runtime…' : 'Apply port'}
              </Button>
            </div>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => apply(!enabled)}>
              {busy
                ? 'Restarting runtime…'
                : enabled
                  ? 'Limit access to this Mac'
                  : 'Enable LAN / VPN access'}
            </Button>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Managed by your runtime launcher. Change DOVO_HOST or DOVO_PORT there, then restart that
            service.
          </p>
        )}
      </details>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
