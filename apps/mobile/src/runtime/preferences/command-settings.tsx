import { Switch } from '../../ui/controls/switch'
import { mobileWorkflow, nativeEffect } from '../state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from '../state/application-state'
import { useEffect, useRef } from 'react'
import { Linking, View } from 'react-native'
import { Text } from '../../ui/content/text'
import {
  commandFields,
  commandSettingsResponse,
  cuaCheckResponse,
  type CuaCheck,
  type CommandSettings as Settings,
} from '@dovo/protocol'
import { useRuntime } from '../connection/provider'
import { Field } from '../../ui/controls/field'
import { Action } from '../../ui/controls/action'
import { useAction } from '../../ui/controls/use-action'
import { styles } from '../../ui/theme'
export function CommandSettings() {
  const { read, connected, callEffect, readEffect } = useRuntime()
  const { busy, error, act } = useAction()
  const [settings, setSettings] = useApplicationState<Settings | null>(null)
  const [baseline, setBaseline] = useApplicationState<Settings | null>(null)
  const [defaultShell, setDefaultShell] = useApplicationState('')
  const [loadError, setLoadError] = useApplicationState('')
  const cuaGeneration = useRef(0)
  const [cua, setCua] = useApplicationState<CuaCheck | null>(null)
  const [saved, setSaved] = useApplicationState(false)
  useEffect(() => {
    let stopped = false
    const generation = ++cuaGeneration.current
    setSettings(null)
    setBaseline(null)
    setLoadError('')
    setCua(null)
    if (connected)
      void runClientEffect(
        readEffect('/api/commands/read', {}, commandSettingsResponse)
          .pipe(
            Effect.flatMap((result) =>
              nativeEffect(() => {
                if (!stopped) {
                  setSettings(result.settings)
                  setBaseline(result.settings)
                  setDefaultShell(result.defaultShell)
                }
              }).pipe(
                Effect.flatMap(() =>
                  readEffect(
                    '/api/commands/cua/check',
                    { path: result.settings.cua },
                    cuaCheckResponse,
                  ),
                ),
                Effect.flatMap((check) =>
                  nativeEffect(() => {
                    if (!stopped && generation === cuaGeneration.current) setCua(check)
                  }),
                ),
              ),
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
      cuaGeneration.current++
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
                if (field.id === 'cua') {
                  cuaGeneration.current++
                  setCua(null)
                }
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
          <View style={styles.row}>
            <Text style={styles.text}>Enable agent computer use on this computer</Text>
            <Switch
              accessibilityLabel="Enable agent computer use on this computer"
              value={settings.cuaEnabled}
              disabled={busy}
              onValueChange={(value) => {
                setSettings({ ...settings, cuaEnabled: value })
                setSaved(false)
              }}
            />
          </View>
          <Text style={styles.muted}>
            Grants writable agents access to this computer’s desktop. Read-only agents are excluded.
            The user and agents share the desktop and app state.
          </Text>
          <Text style={styles.muted}>
            Leave Cua Driver empty to detect it on this computer’s PATH or in its standard
            installation folder. Changes apply to new agent turns.
          </Text>
          <Action
            label="Install and set up Cua Driver"
            disabled={busy}
            onPress={() => act(() => Linking.openURL('https://cua.ai/docs/cua-driver/quickstart'))}
          />
          <Action
            label="Detect / check Cua Driver"
            disabled={busy}
            onPress={() =>
              act(() =>
                mobileWorkflow(function* () {
                  const generation = ++cuaGeneration.current
                  setCua(null)
                  const result = yield* readEffect(
                    '/api/commands/cua/check',
                    { path: settings.cua },
                    cuaCheckResponse,
                  )
                  if (generation === cuaGeneration.current) setCua(result)
                }),
              )
            }
          />
          {cua && (
            <View>
              <Text style={styles.muted}>
                {cua.available ? 'Cua Driver found' : 'Cua Driver unavailable'}
                {cua.version ? ` · ${cua.version}` : ''}
              </Text>
              {cua.path && <Text style={styles.muted}>{cua.path}</Text>}
              <Text style={styles.muted}>{cua.detail}</Text>
              {cua.daemon && <Text style={styles.muted}>Daemon: {cua.daemon}</Text>}
              {cua.permissions && <Text style={styles.muted}>Permissions: {cua.permissions}</Text>}
              <Text style={styles.muted}>
                {cua.platform === 'darwin'
                  ? 'Grant Accessibility and Screen Recording to CuaDriver on this Mac, then restart its daemon.'
                  : cua.platform === 'win32'
                    ? 'Run Cua Driver in an interactive Windows desktop session.'
                    : 'Cua Driver needs a Linux desktop session. A WSL runtime checks Linux tools, not the Windows desktop.'}
              </Text>
            </View>
          )}
          <Action
            label="Save command settings"
            disabled={busy || !baseline}
            onPress={() =>
              act(() =>
                mobileWorkflow(function* () {
                  const result = yield* callEffect(
                    '/api/commands/save',
                    {
                      before: baseline,
                      after: { ...settings, shellArgs: settings.shellArgs.filter(Boolean) },
                    },
                    commandSettingsResponse,
                  )
                  setSettings(result.settings)
                  setBaseline(result.settings)
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
