import { mobileWorkflow, nativeEffect } from './native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from './application-state'
import { useEffect } from 'react'
import { View } from 'react-native'
import { Text } from '../ui/text'
import {
  commandFields,
  commandSettingsResponse,
  type CommandSettings as Settings,
} from '@dovo/protocol'
import { useRuntime } from './provider'
import { Field } from '../ui/field'
import { Action } from '../ui/action'
import { useAction } from '../ui/use-action'
import { styles } from '../ui/theme'
export function CommandSettings() {
  const { read, connected, callEffect, readEffect } = useRuntime()
  const { busy, error, act } = useAction()
  const [settings, setSettings] = useApplicationState<Settings | null>(null)
  const [defaultShell, setDefaultShell] = useApplicationState('')
  const [loadError, setLoadError] = useApplicationState('')
  const [saved, setSaved] = useApplicationState(false)
  useEffect(() => {
    let stopped = false
    setSettings(null)
    setLoadError('')
    if (connected)
      void runClientEffect(
        readEffect('/api/commands/read', {}, commandSettingsResponse)
          .pipe(
            Effect.flatMap((result) =>
              nativeEffect(() => {
                if (!stopped) {
                  setSettings(result.settings)
                  setDefaultShell(result.defaultShell)
                }
              }),
            ),
          )
          .pipe(
            Effect.catchAll((error) =>
              nativeEffect(() => {
                if (!stopped) setLoadError(String(error))
              }),
            ),
          ),
      )
    return () => {
      stopped = true
    }
  }, [read, connected])
  if (!connected) return null
  return (
    <View style={styles.card}>
      <Text style={styles.text}>CLI commands & shell</Text>
      <Text style={styles.muted}>
        Host executable names or paths, without shell quoting. Agent overrides take precedence. New
        terminals use these shell settings.
      </Text>
      {settings && (
        <>
          {commandFields.map((field) => (
            <Field
              key={field.id}
              label={field.label}
              value={settings[field.id]}
              editable={!busy}
              placeholder={field.id === 'shell' ? defaultShell : field.placeholder}
              onChangeText={(value) => {
                setSettings({
                  ...settings,
                  [field.id]: value,
                })
                setSaved(false)
              }}
            />
          ))}
          <Field
            label="Shell arguments (one per line)"
            multiline
            editable={!busy}
            value={settings.shellArgs.join('\n')}
            onChangeText={(value) => {
              setSettings({
                ...settings,
                shellArgs: value.split('\n'),
              })
              setSaved(false)
            }}
          />
          <Text style={styles.muted}>
            Automatic shell: {defaultShell}. Default: -l (login shell).
          </Text>
          <Action
            label="Save command settings"
            disabled={busy}
            onPress={() =>
              act(() =>
                mobileWorkflow(function* () {
                  const result = yield* callEffect(
                    '/api/commands/save',
                    {
                      ...settings,
                      shellArgs: settings.shellArgs.filter(Boolean),
                    },
                    commandSettingsResponse,
                  )
                  setSettings(result.settings)
                  setSaved(true)
                }),
              )
            }
          />
          {saved && <Text style={styles.muted}>Command settings saved.</Text>}
        </>
      )}
      {!!(error || loadError) && <Text style={styles.error}>{error || loadError}</Text>}
    </View>
  )
}
