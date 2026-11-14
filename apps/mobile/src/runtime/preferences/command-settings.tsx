import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { useSettingsDraft } from './settings-target'
import { SettingsSaveBar } from '../../screens/settings-save-bar'
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
  settingsChangeCount,
  settingsChanges,
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
import { SettingsField as Field } from '../../screens/settings-controls'
import { SettingsAction as Action } from '../../screens/settings-controls'
import { useAction } from '../../ui/controls/use-action'
import { useTheme } from '../../ui/theme'
export function CommandSettings({ computerUse = false }: { computerUse?: boolean }) {
  const uiText = useInterfaceText()

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
  const [retry, setRetry] = useApplicationState(0)
  const dirty = !!baseline && settingsChangeCount(baseline, settings ?? {}) > 0
  const protectDraft = useRef(false)
  protectDraft.current = dirty
  useSettingsDraft(dirty, busy)
  useEffect(() => {
    const generation = ++cuaGeneration.current
    if (protectDraft.current) return
    let stopped = false
    setSaved(false)
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
  }, [read, connected, computerUse, retry])
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
  return (
    <View style={styles.card}>
      {!connected && (
        <Text accessibilityRole="alert" style={styles.muted}>
          <InterfaceText>
            {'Offline · your unsaved edits are kept here. Reconnect to save.'}
          </InterfaceText>
        </Text>
      )}
      <Text style={styles.text}>
        {computerUse ? uiText('Computer use') : uiText('CLI commands & shell')}
      </Text>
      <Text style={styles.muted}>
        {computerUse
          ? uiText(
              'Set up CuaDriver on this runtime host. CuaDriver owns OS permissions; Dovo connects agents through MCP.',
            )
          : uiText(
              'Host executable names or paths, without shell quoting. Agent overrides take precedence. New terminals use these shell settings.',
            )}
      </Text>
      {!settings && !loadError && (
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          <InterfaceText
            values={{ value0: computerUse ? uiText('computer-use') : uiText('command') }}
          >
            {'Loading {value0} settings…'}
          </InterfaceText>
        </Text>
      )}
      {settings && (
        <>
          {commandFields
            .filter((field) => (computerUse ? field.id === 'cua' : field.id !== 'cua'))
            .map((field) => (
              <Field
                key={field.id}
                label={field.label}
                value={settings[field.id]}
                editable={!busy && connected}
                autoCapitalize="none"
                autoCorrect={false}
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
              label={uiText('Shell arguments (one per line)')}
              multiline
              editable={!busy && connected}
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
              <InterfaceText values={{ value0: defaultShell }}>
                {'Automatic shell: {value0}. Default: -l (login shell).'}
              </InterfaceText>
            </Text>
          )}
          {computerUse && (
            <>
              <View style={styles.row}>
                <Text style={styles.text}>
                  <InterfaceText>{'Enable agent computer use on this computer'}</InterfaceText>
                </Text>
                <Switch
                  accessibilityLabel={uiText('Enable agent computer use on this computer')}
                  value={settings.cuaEnabled}
                  disabled={busy || !connected}
                  onValueChange={(value) => {
                    setSettings({ ...settings, cuaEnabled: value })
                    setSaved(false)
                  }}
                />
              </View>
              <Text style={styles.muted}>
                <InterfaceText>
                  {
                    'Grants writable agents access to this computer’s desktop. Read-only agents are excluded. The user and agents share the desktop and app state.'
                  }
                </InterfaceText>
              </Text>
              <Text style={styles.muted}>
                <InterfaceText>
                  {
                    'Leave Cua Driver empty to detect it on this computer’s PATH or in its standard installation folder. Changes apply to new agent turns.'
                  }
                </InterfaceText>
              </Text>
              {cua && (
                <View style={styles.card}>
                  <Text style={styles.text}>
                    <InterfaceText>{'1. Install on this computer'}</InterfaceText>
                  </Text>
                  <Text style={styles.muted}>{cuaInstallHelp(cua.platform).prerequisites}</Text>
                  <Text style={styles.muted}>
                    <InterfaceText>
                      {
                        'Run the official installer on the runtime host, then refresh status. It downloads and installs CuaDriver; no Cua account is required.'
                      }
                    </InterfaceText>
                  </Text>
                  <Text selectable style={styles.muted}>
                    {cuaInstallHelp(cua.platform).commands}
                  </Text>
                  {cua.platform === 'linux' && (
                    <Text style={styles.muted}>
                      <InterfaceText>
                        {
                          'Minimal Linux systems need libxi6 and at-spi2-core. GNOME needs Cua’s bundled WinRects helper; see the installation guide.'
                        }
                      </InterfaceText>
                    </Text>
                  )}
                </View>
              )}
              <Action
                label={uiText('Install and set up Cua Driver')}
                disabled={busy || !connected}
                onPress={() =>
                  act(() => Linking.openURL('https://cua.ai/docs/cua-driver/quickstart'))
                }
              />
              <Action
                label={uiText('Detect / check Cua Driver')}
                disabled={busy || !connected}
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
                        ? uiText('2. Permissions & desktop access')
                        : group === 'skills'
                          ? uiText('3. Agent MCP, skills & hooks')
                          : uiText('4. Computer History (optional preview)')}
                    </Text>
                    <Text style={styles.muted}>
                      {group === 'setup'
                        ? uiText(
                            'Grant macOS Accessibility and Screen Recording to CuaDriver and accept its relaunch. Test desktop access lists apps without changing them. Daemon controls affect active computer-use sessions.',
                          )
                        : group === 'skills'
                          ? uiText(
                              'Save the computer-use switch for automatic dovo_cua MCP on new writable turns. No manual MCP registration is needed. Install the optional official skill pack; installation links detected agents on this computer.',
                            )
                          : uiText(
                              'Opt-in, encrypted, metadata-only history. Enable may restart the daemon. Disable keeps recorded data; pause temporarily stops recording. Unsupported builds report an error. Data stays on the runtime host; View recent history retrieves up to 20 events here.',
                            )}
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
                          disabled={busy || !connected || cuaActionDisabled(action.id, cua)}
                          onPress={() => {
                            if (action.id === 'history-delete') {
                              Alert.alert(
                                uiText('Delete recorded Computer History?'),
                                uiText(
                                  'Delete all recorded history and its encryption key on this computer. This cannot be undone.',
                                ),
                                [
                                  { text: uiText('Cancel'), style: 'cancel' },
                                  {
                                    text: uiText('Delete'),
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
                    {cua.available ? uiText('Cua Driver found') : uiText('Cua Driver unavailable')}
                    {cua.version ? ` · ${cua.version}` : ''}
                  </Text>
                  {cua.path && <Text style={styles.muted}>{cua.path}</Text>}
                  <Text style={styles.muted}>{cua.detail}</Text>
                  {cua.daemon && (
                    <Text style={styles.muted}>
                      <InterfaceText values={{ value0: cua.daemon }}>
                        {'Daemon: {value0}'}
                      </InterfaceText>
                    </Text>
                  )}
                  {cua.permissions && (
                    <Text style={styles.muted}>
                      <InterfaceText values={{ value0: cua.permissions }}>
                        {'Permissions: {value0}'}
                      </InterfaceText>
                    </Text>
                  )}
                  <Text style={styles.muted}>
                    {cua.platform === 'darwin'
                      ? uiText(
                          'Grant Accessibility and Screen Recording to CuaDriver on this Mac, then restart its daemon.',
                        )
                      : cua.platform === 'win32'
                        ? uiText('Run Cua Driver in an interactive Windows desktop session.')
                        : uiText(
                            'Cua Driver needs a Linux desktop session. A WSL runtime checks Linux tools, not the Windows desktop.',
                          )}
                  </Text>
                </View>
              )}
            </>
          )}
          <SettingsSaveBar
            changes={settingsChanges(baseline ?? {}, settings ?? {})}
            saveError={error}
            readLatestChanges={async () =>
              settingsChanges(
                baseline ?? {},
                await runClientEffect(
                  readEffect('/api/commands/read', {}, commandSettingsResponse),
                ).then((value) => value.settings),
              )
            }
            dirty={dirty}
            saving={busy}
            disabled={!connected || !baseline}
            saved={saved}
            changeCount={settingsChangeCount(baseline ?? {}, settings ?? {})}
            onDiscard={() => {
              setSettings(baseline)
              setSaved(false)
            }}
            onSave={() =>
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
            <Text accessibilityLiveRegion="polite" style={styles.muted}>
              {computerUse
                ? uiText('Computer-use settings saved. Applies to new turns.')
                : uiText('Command settings saved.')}
            </Text>
          )}
        </>
      )}
      {!!(error || loadError) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error || loadError}
        </Text>
      )}
      {!!(loadError || error) && (
        <Action
          wide
          secondary
          label={uiText('Retry command settings')}
          disabled={busy || !connected}
          onPress={() => {
            const reload = () => {
              setBaseline(settings)
              setRetry(retry + 1)
            }
            if (!dirty) reload()
            else
              Alert.alert(
                uiText('Discard unsaved edits?'),
                uiText('Load the latest saved settings and discard your edits?'),
                [
                  { text: uiText('Keep editing'), style: 'cancel' },
                  { text: uiText('Discard and reload'), style: 'destructive', onPress: reload },
                ],
              )
          }}
        />
      )}
    </View>
  )
}
