import { useEffect } from 'react'
import { Effect } from 'effect'
import { runtimePreferencesSchema } from '@dovo/protocol'
import { clientTaskScope, useWorkspace } from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
export function RuntimePreferences() {
  const { requestEffect, connected } = useWorkspace()
  const [value, setValue] = useApplicationState<boolean | null>(null)
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  useEffect(() => {
    setValue(null)
    setError('')
    if (!connected) return
    const scope = clientTaskScope()
    void scope.run(
      requestEffect('/api/runtime/preferences/read', {}, runtimePreferencesSchema).pipe(
        Effect.tap((settings) => Effect.sync(() => setValue(settings.autoContinueAfterRestart))),
        Effect.asVoid,
        Effect.catchAll((error) => Effect.sync(() => setError(error.message))),
      ),
    )
    return () => {
      void scope.stop()
    }
  }, [requestEffect, connected])
  return (
    <section className="space-y-2 rounded border p-4">
      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={value ?? false}
          disabled={!connected || busy || value === null}
          onChange={(event) => {
            const enabled = event.target.checked
            setBusy(true)
            setError('')
            void Effect.runPromise(
              requestEffect(
                '/api/runtime/preferences/save',
                { autoContinueAfterRestart: enabled },
                runtimePreferencesSchema,
              ).pipe(
                Effect.tap((settings) =>
                  Effect.sync(() => setValue(settings.autoContinueAfterRestart)),
                ),
                Effect.catchAll((error) => Effect.sync(() => setError(error.message))),
                Effect.ensuring(Effect.sync(() => setBusy(false))),
              ),
            )
          }}
        />
        Auto-continue tasks after runtime restart
      </label>
      <p className="text-xs text-muted-foreground">
        Off by default. When enabled, interrupted tasks and unpaused message queues resume one at a
        time on this computer. Explicitly paused or stopped tasks stay paused. Automations still
        require Retry. Changes are saved immediately.
      </p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
