import { useEffect } from 'react'
import { Effect, Schema } from 'effect'
import { decode, decodeResult, mutableStruct } from '@dovo/protocol'
import { clientTaskScope, useWorkspace } from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import { Button } from '@dovo/studio-ui'
const statusSchema = mutableStruct({
  local: Schema.Boolean,
  host: Schema.String,
  canChange: Schema.Boolean,
})
const bridgeSchema = mutableStruct({
  dovo: mutableStruct({
    runtimeNetwork: Schema.Unknown.pipe(
      Schema.filter(
        (value): value is (address: string, enabled?: boolean) => Promise<unknown> =>
          typeof value === 'function',
      ),
    ),
  }),
})
export function DesktopNetwork({ onChanged }: { onChanged: () => Promise<void> }) {
  const { connection } = useWorkspace()
  const [status, setStatus] = useApplicationState<Schema.Schema.Type<typeof statusSchema> | null>(
    null,
  )
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  useEffect(() => {
    setStatus(null)
    const bridge = decodeResult(bridgeSchema, window)
    if (!connection || !bridge.success) return
    const scope = clientTaskScope()
    void scope.run(
      Effect.tryPromise({
        try: async () =>
          setStatus(
            decode(statusSchema, await bridge.data.dovo.runtimeNetwork(connection.address)),
          ),
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
  return (
    <div className="space-y-2 rounded border bg-muted/30 p-3">
      <details open={!enabled}>
        <summary className="cursor-pointer text-sm font-medium">
          {enabled ? 'LAN / VPN connections enabled' : 'Connections limited to this Mac'}
        </summary>
        <p className="mt-2 text-xs text-muted-foreground">
          Listening on {status.host}. Phones need LAN or VPN access. Pairing and device tokens are
          always required; HTTP is supported.
        </p>
        {status.canChange ? (
          <>
            <p className="text-xs text-muted-foreground">
              Changing this restarts the runtime and briefly disconnects clients. Finish or stop
              running tasks first.
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                const bridge = decodeResult(bridgeSchema, window)
                if (!bridge.success) return
                setBusy(true)
                setError('')
                void Effect.runPromise(
                  Effect.tryPromise({
                    try: async () => {
                      setStatus(
                        decode(
                          statusSchema,
                          await bridge.data.dovo.runtimeNetwork(connection.address, !enabled),
                        ),
                      )
                      await onChanged()
                    },
                    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
                  }).pipe(
                    Effect.catchAll((cause) => Effect.sync(() => setError(cause.message))),
                    Effect.ensuring(Effect.sync(() => setBusy(false))),
                  ),
                )
              }}
            >
              {busy
                ? 'Restarting runtime…'
                : enabled
                  ? 'Limit access to this Mac'
                  : 'Enable LAN / VPN access'}
            </Button>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Managed by your runtime launcher. Set DOVO_HOST=0.0.0.0 (or your VPN interface address),
            then restart that service to allow phone connections.
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
