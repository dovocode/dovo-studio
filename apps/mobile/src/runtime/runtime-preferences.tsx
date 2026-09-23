import { useEffect } from 'react'
import { Switch, View } from 'react-native'
import { Effect } from 'effect'
import { clientTaskScope } from '@dovo/client-runtime'
import { runtimePreferencesSchema } from '@dovo/protocol'
import { useApplicationState } from './application-state'
import { useRuntime } from './provider'
import { useAction } from '../ui/use-action'
import { Text } from '../ui/text'
import { styles } from '../ui/theme'
export function RuntimePreferences() {
  const { connected, readEffect, callEffect } = useRuntime()
  const [value, setValue] = useApplicationState<boolean | null>(null)
  const [loadError, setLoadError] = useApplicationState('')
  const { act, busy, error } = useAction()
  useEffect(() => {
    setValue(null)
    setLoadError('')
    if (!connected) return
    const scope = clientTaskScope()
    void scope.run(
      readEffect('/api/runtime/preferences/read', {}, runtimePreferencesSchema).pipe(
        Effect.tap((settings) => Effect.sync(() => setValue(settings.autoContinueAfterRestart))),
        Effect.asVoid,
        Effect.catchAll((error) => Effect.sync(() => setLoadError(error.message))),
      ),
    )
    return () => {
      void scope.stop()
    }
  }, [connected, readEffect])
  return (
    <View style={[styles.card, { gap: 10 }]}>
      <Text style={styles.text}>Auto-continue tasks after runtime restart</Text>
      <Switch
        accessibilityLabel="Auto-continue tasks after runtime restart"
        value={value ?? false}
        disabled={!connected || busy || value === null}
        onValueChange={(enabled) =>
          act(() =>
            callEffect(
              '/api/runtime/preferences/save',
              { autoContinueAfterRestart: enabled },
              runtimePreferencesSchema,
            ).pipe(
              Effect.tap((settings) =>
                Effect.sync(() => setValue(settings.autoContinueAfterRestart)),
              ),
            ),
          )
        }
      />
      <Text style={styles.muted}>
        Off by default. Interrupted tasks and unpaused queues resume one at a time on this computer.
        Explicitly paused or stopped tasks stay paused. Automations require Retry. Saved
        immediately.
      </Text>
      {!!(error || loadError) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error || loadError}
        </Text>
      )}
    </View>
  )
}
