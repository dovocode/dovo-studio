import { Switch } from '../../ui/controls/switch'
import { mobileWorkflow, nativeEffect } from '../state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from '../state/application-state'
import { useEffect, useRef } from 'react'
import { Alert, Linking, View } from 'react-native'
import { Text } from '../../ui/content/text'
import {
  commandFields,
  commandSettingsResponse,
  cuaCheckResponse,
  cuaActionResponse,
  cuaActions,
  cuaActionDisabled,
  cuaHistorySummary,
  cuaInstallHelp,
  type CuaAction,
  type CuaCheck,
  type CommandSettings as Settings,
} from '@dovo/protocol'
import { useRuntime } from '../connection/provider'
import { Field } from '../../ui/controls/field'
import { Action } from '../../ui/controls/action'
import { useAction } from '../../ui/controls/use-action'
import { useTheme } from '../../ui/theme'
export function CommandSettings({ computerUse = false }: { computerUse?: boolean }) {
  const { styles } = useTheme()

  const { read, connected, callEffect, readEffect } = useRuntime()
  const { busy, error, act } = useAction()
  const [settings, setSettings] = useApplicationState<Settings | null>(null)
  const [baseline, setBaseline] = useApplicationState<Settings | null>(null)
  const [defaultShell, setDefaultShell] = useApplicationState('')
  const [loadError, setLoadError] = useApplicationState('')
  const cuaGeneration = useRef(0)
  const [cua, setCua] = useApplicationState<CuaCheck | null>(null)
  const [output, setOutput] = useApplicationState('')
  const [saved, setSaved] = useApplicationState(false)
  useEffect(() => {
    let stopped = false
    const generation = ++cuaGeneration.current
    setSettings(null)
    setBaseline(null)
    setLoadError('')
    setCua(null)
    setOutput('')
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
                  computerUse
                    ? readEffect(
                        '/api/commands/cua/check',
                        { path: result.settings.cua },
                        cuaCheckResponse,
                      )
                    : Effect.succeed(null),
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
            Effect.catch((error) =>
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
  }, [read, connected, computerUse])
  const runAction = (action: CuaAction) =>
    act(() =>
      mobileWorkflow(function* () {
        if (!settings) return
        const generation = ++cuaGeneration.current
        setOutput('')
        const result = yield* callEffect(
          '/api/commands/cua/action',
          { path: settings.cua, action },
          cuaActionResponse,
        )
        if (generation === cuaGeneration.current) {
          setOutput(result.output)
          setCua(result.check)
        }
      }),
    )
  if (!connected) return null
  return (
    <View style={styles.card}>
      <Text style={styles.text}>{computerUse ? 'Computer use' : 'CLI commands & shell'}</Text>
      <Text style={styles.muted}>
        {computerUse
          ? 'Set up CuaDriver on this runtime host. CuaDriver owns OS permissions; Dovo connects agents through MCP.'
          : 'Host executable names or paths, without shell quoting. Agent overrides take precedence. New terminals use these shell settings.'}
      </Text>
      {settings && (
        <>
          {commandFields
            .filter((field) => (computerUse ? field.id === 'cua' : field.id !== 'cua'))
            .map((field) => (
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
                    setOutput('')
                  }
                  setSettings({
                    ...settings,
                    [field.id]: value,
                  })
                  setSaved(false)
                }}
              />
            ))}
          {!computerUse && (
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
          )}
          {!computerUse && (
            <Text style={styles.muted}>
              Automatic shell: {defaultShell}. Default: -l (login shell).
            </Text>
          )}
          {computerUse && (
            <>
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
                Grants writable agents access to this computer’s desktop. Read-only agents are
                excluded. The user and agents share the desktop and app state.
              </Text>
              <Text style={styles.muted}>
                Leave Cua Driver empty to detect it on this computer’s PATH or in its standard
                installation folder. Changes apply to new agent turns.
              </Text>
              {cua && (
                <View style={styles.card}>
                  <Text style={styles.text}>1. Install on this computer</Text>
                  <Text style={styles.muted}>{cuaInstallHelp(cua.platform).prerequisites}</Text>
                  <Text style={styles.muted}>
                    Run the official installer on the runtime host, then refresh status. It
                    downloads and installs CuaDriver; no Cua account is required.
                  </Text>
                  <Text selectable style={styles.muted}>
                    {cuaInstallHelp(cua.platform).commands}
                  </Text>
                  {cua.platform === 'linux' && (
                    <Text style={styles.muted}>
                      Minimal Linux systems need libxi6 and at-spi2-core. GNOME needs Cua’s bundled
                      WinRects helper; see the installation guide.
                    </Text>
                  )}
                </View>
              )}
              <Action
                label="Install and set up Cua Driver"
                disabled={busy}
                onPress={() =>
                  act(() => Linking.openURL('https://cua.ai/docs/cua-driver/quickstart'))
                }
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
              {cua?.available &&
                (['setup', 'skills', 'history'] as const).map((group) => (
                  <View key={group} style={styles.card}>
                    <Text style={styles.text}>
                      {group === 'setup'
                        ? '2. Permissions & desktop access'
                        : group === 'skills'
                          ? '3. Agent MCP & skills'
                          : '4. Computer History (optional preview)'}
                    </Text>
                    <Text style={styles.muted}>
                      {group === 'setup'
                        ? 'Grant macOS Accessibility and Screen Recording to CuaDriver and accept its relaunch. Test desktop access lists apps without changing them. Daemon controls affect active computer-use sessions.'
                        : group === 'skills'
                          ? 'Save the computer-use switch for automatic dovo_cua MCP on new writable turns. No manual MCP registration is needed. Install the optional official skill pack; installation links detected agents on this computer.'
                          : 'Opt-in, encrypted, metadata-only history. Enable may restart the daemon. Disable keeps recorded data; pause temporarily stops recording. Unsupported builds report an error. Data stays on the runtime host; View recent history retrieves up to 20 events here.'}
                    </Text>
                    {cuaActions
                      .filter(
                        (action) =>
                          action.group === group &&
                          (action.id !== 'permissions' || cua.platform === 'darwin') &&
                          (action.id !== 'start' || cua.platform !== 'linux'),
                      )
                      .map((action) => (
                        <Action
                          key={action.id}
                          label={action.label}
                          disabled={busy || cuaActionDisabled(action.id, cua)}
                          onPress={() => {
                            if (action.id === 'history-delete') {
                              Alert.alert(
                                'Delete recorded Computer History?',
                                'Delete all recorded history and its encryption key on this computer. This cannot be undone.',
                                [
                                  { text: 'Cancel', style: 'cancel' },
                                  {
                                    text: 'Delete',
                                    style: 'destructive',
                                    onPress: () => runAction(action.id),
                                  },
                                ],
                              )
                            } else runAction(action.id)
                          }}
                        />
                      ))}
                    {group === 'skills' && cua.skills && (
                      <Text selectable style={styles.muted}>
                        {cua.skills}
                      </Text>
                    )}
                    {group === 'history' && cua.history && (
                      <Text selectable style={styles.muted}>
                        {cuaHistorySummary(cua)}
                      </Text>
                    )}
                  </View>
                ))}
              {!!output && (
                <Text selectable style={styles.muted}>
                  {output}
                </Text>
              )}
              {cua && (
                <View>
                  <Text style={styles.muted}>
                    {cua.available ? 'Cua Driver found' : 'Cua Driver unavailable'}
                    {cua.version ? ` · ${cua.version}` : ''}
                  </Text>
                  {cua.path && <Text style={styles.muted}>{cua.path}</Text>}
                  <Text style={styles.muted}>{cua.detail}</Text>
                  {cua.daemon && <Text style={styles.muted}>Daemon: {cua.daemon}</Text>}
                  {cua.permissions && (
                    <Text style={styles.muted}>Permissions: {cua.permissions}</Text>
                  )}
                  <Text style={styles.muted}>
                    {cua.platform === 'darwin'
                      ? 'Grant Accessibility and Screen Recording to CuaDriver on this Mac, then restart its daemon.'
                      : cua.platform === 'win32'
                        ? 'Run Cua Driver in an interactive Windows desktop session.'
                        : 'Cua Driver needs a Linux desktop session. A WSL runtime checks Linux tools, not the Windows desktop.'}
                  </Text>
                </View>
              )}
            </>
          )}
          <Action
            label={computerUse ? 'Save computer-use settings' : 'Save command settings'}
            disabled={busy || !baseline}
            onPress={() =>
              act(() =>
                mobileWorkflow(function* () {
                  const result = yield* callEffect(
                    '/api/commands/save',
                    {
                      before: baseline,
                      after: computerUse
                        ? settings
                        : { ...settings, shellArgs: settings.shellArgs.filter(Boolean) },
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
          {saved && (
            <Text style={styles.muted}>
              {computerUse
                ? 'Computer-use settings saved. Applies to new turns.'
                : 'Command settings saved.'}
            </Text>
          )}
        </>
      )}
      {!!(error || loadError) && <Text style={styles.error}>{error || loadError}</Text>}
    </View>
  )
}
