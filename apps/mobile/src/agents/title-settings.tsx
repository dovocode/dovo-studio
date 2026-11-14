import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { SecretReferenceFields } from './secret-reference-fields'
import { SettingsSaveBar } from '../screens/settings-save-bar'
import { useSettingsDraft } from '../runtime/preferences/settings-target'
import { settingsChanges, supportsUtilities } from '@dovo/protocol'
import { configuredTaskHarness } from '@dovo/protocol'
import { mobileWorkflow, nativeEffect } from '../runtime/state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from '../runtime/state/application-state'
import { decode } from '@dovo/protocol'
import { useEffect, useRef } from 'react'
import { Alert, Pressable, View } from 'react-native'
import { Text } from '../ui/content/text'
import {
  agentSchema,
  acpHarnessChoiceId,
  acpInstallationHarness,
  defaultTaskHarness,
  resolveTitleHarness,
  titleSettingsForHarness,
  titleGenerationSettingsSchema,
  type TitleGenerationSettings,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { AcpRegistry } from './acp-registry'
import { ModelSettings } from './model-settings'
import { SettingsChoice as Choice } from '../screens/settings-controls'
import { SettingsField as Field } from '../screens/settings-controls'
import { SettingsAction as Action } from '../screens/settings-controls'
import { useTheme } from '../ui/theme'
import { useAction } from '../ui/controls/use-action'
export function TitleSettings({ selection = false }: { selection?: boolean }) {
  const uiText = useInterfaceText()

  const settingsPath = selection ? '/api/agents/selection-settings' : '/api/agents/title-settings'
  const { styles } = useTheme()

  const { call, connected, snapshot, callEffect } = useRuntime(),
    { act, busy, error } = useAction()
  const [settings, setSettings] = useApplicationState<TitleGenerationSettings | undefined>(
      undefined,
    ),
    [baseline, setBaseline] = useApplicationState<TitleGenerationSettings | undefined>(undefined),
    [loadError, setLoadError] = useApplicationState('')
  const [retry, setRetry] = useApplicationState(0)
  const [saved, setSaved] = useApplicationState(false)
  const [promptsOpen, setPromptsOpen] = useApplicationState(false)
  const dirty = !!settings && JSON.stringify(settings) !== JSON.stringify(baseline)
  const protectDraft = useRef(false)
  protectDraft.current = dirty
  useSettingsDraft(dirty, busy)
  useEffect(() => {
    if (protectDraft.current) return
    let active = true
    setSettings(undefined)
    setBaseline(undefined)
    setLoadError('')
    setSaved(false)
    if (connected)
      void runClientEffect(
        callEffect(`${settingsPath}/read`, {}, titleGenerationSettingsSchema)
          .pipe(
            Effect.flatMap((value) =>
              nativeEffect(() => {
                if (active) {
                  setSettings(value)
                  setBaseline(value)
                }
              }),
            ),
          )
          .pipe(
            Effect.catch((error) =>
              nativeEffect(() => {
                if (active) setLoadError(String(error))
              }),
            ),
          ),
      )
    return () => {
      active = false
    }
  }, [call, connected, retry, settingsPath])
  useEffect(() => {
    if (settings !== baseline) setSaved(false)
  }, [settings, baseline])
  if (
    selection &&
    snapshot?.smartModelSelectionEnabled !== true &&
    snapshot?.autoProjectSelectionEnabled !== true
  )
    return null
  if (!settings)
    return (
      <View style={{ gap: 12 }}>
        <Text accessibilityLiveRegion="polite" style={loadError ? styles.error : styles.muted}>
          {!connected
            ? uiText('This computer is offline. Reconnect to load title settings.')
            : loadError || uiText('Loading title settings…')}
        </Text>
        {!!loadError && (
          <Action
            secondary
            label={uiText('Retry title settings')}
            disabled={!connected || busy}
            onPress={() => setRetry(retry + 1)}
          />
        )}
      </View>
    )
  const harness = resolveTitleHarness(
    settings,
    snapshot?.workspace.agents ?? [],
    configuredTaskHarness(snapshot?.defaults),
  )
  const installations = snapshot?.acpInstallations ?? []
  const agent = {
    ...(harness ?? defaultTaskHarness('codex')),
    id: 'title',
    name: uiText('Title generator'),
    model: settings.model,
    reasoning: settings.reasoning,
  }
  return (
    <View style={styles.card}>
      <Text style={[styles.title, { fontWeight: '600' }]}>
        {selection
          ? uiText('Scope, Tune & Maestro selector (experimental)')
          : uiText('Titles & dictation')}
      </Text>
      <Text style={styles.muted}>
        {selection
          ? uiText(
              'Selects projects, harnesses and coding models. Inherits the explicit title model unless overridden.',
            )
          : uiText(
              'Choose a coding harness or direct API model for titles, commit and PR text, and dictation cleanup.',
            )}
      </Text>
      {snapshot?.textGeneratorsSupported && !(selection && settings.inheritTitleModel) && (
        <View style={{ gap: 10 }}>
          <Choice
            label={uiText('Generate text with')}
            value={settings.generator?.kind ?? 'harness'}
            disabled={busy}
            items={[
              { id: 'harness', name: uiText('Coding harness') },
              { id: 'openai', name: uiText('OpenAI-compatible API') },
              { id: 'anthropic', name: uiText('Anthropic API') },
            ]}
            onChange={(kind) => {
              if (kind === 'harness') setSettings({ ...settings, generator: undefined })
              else if (kind === 'openai' || kind === 'anthropic')
                setSettings({
                  ...settings,
                  generator: {
                    kind,
                    model: '',
                    baseUrl:
                      kind === 'openai'
                        ? 'https://api.openai.com/v1'
                        : 'https://api.anthropic.com/v1',
                    apiKey: {
                      provider: 'environment',
                      reference: kind === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY',
                    },
                  },
                })
            }}
          />
          {settings.generator && (
            <>
              <Field
                label={uiText('API base URL')}
                value={settings.generator.baseUrl}
                onChangeText={(baseUrl) =>
                  setSettings({ ...settings, generator: { ...settings.generator!, baseUrl } })
                }
              />
              <Field
                label={uiText('API model ID')}
                value={settings.generator.model}
                onChangeText={(model) =>
                  setSettings({ ...settings, generator: { ...settings.generator!, model } })
                }
              />
              <Choice
                label={uiText('API key')}
                value={settings.generator.apiKey ? 'reference' : 'none'}
                items={[
                  { id: 'reference', name: uiText('Host or vault reference') },
                  { id: 'none', name: uiText('No key (local API)') },
                ]}
                onChange={(value) =>
                  setSettings({
                    ...settings,
                    generator: {
                      ...settings.generator!,
                      apiKey:
                        value === 'none'
                          ? undefined
                          : { provider: 'environment', reference: 'OPENAI_API_KEY' },
                    },
                  })
                }
              />
              {settings.generator.apiKey && (
                <SecretReferenceFields
                  value={settings.generator.apiKey}
                  onChange={(apiKey) =>
                    setSettings({ ...settings, generator: { ...settings.generator!, apiKey } })
                  }
                  disabled={busy}
                />
              )}
              <Text style={styles.muted}>
                <InterfaceText>
                  {
                    'Sends utility text to this API. The harness below handles work that needs checkout tools.'
                  }
                </InterfaceText>
              </Text>
            </>
          )}
        </View>
      )}
      <Choice
        label={
          selection ? uiText('Scope, Tune & Maestro selector harness') : uiText('Title harness')
        }
        value={
          selection && settings.inheritTitleModel
            ? 'title'
            : settings.harness
              ? settings.harness.provider === 'acp' && settings.harness.acpInstallationId
                ? acpHarnessChoiceId(settings.harness.acpInstallationId)
                : `harness:${settings.harness.provider}`
              : settings.agentId
                ? `agent:${settings.agentId}`
                : 'default'
        }
        disabled={busy}
        items={[
          { id: 'default', name: uiText('Choose a harness') },
          ...(selection ? [{ id: 'title', name: uiText('Inherit title model') }] : []),
          ...(['codex', 'claude', 'opencode', 'copilot', 'cursor', 'acp'] as const).map(
            (provider) => ({
              id: `harness:${provider}`,
              name: provider,
            }),
          ),
          ...installations.map((installation) => ({
            id: acpHarnessChoiceId(installation.id),
            name: `${installation.name} · ACP`,
          })),
          ...(snapshot?.workspace.agents ?? [])
            .filter((agent) => supportsUtilities(agent.provider))
            .map((agent) => ({
              id: `agent:${agent.id}`,
              name: agent.name,
            })),
        ]}
        onChange={(value) => {
          if (value === 'title') {
            setSettings({ ...settings, inheritTitleModel: true })
            return
          }
          const installation = installations.find((item) => acpHarnessChoiceId(item.id) === value)
          setSettings({
            ...settings,
            inheritTitleModel: selection ? false : undefined,
            agentId: value.startsWith('agent:') ? value.slice(6) : '',
            harness: installation
              ? acpInstallationHarness(installation)
              : value.startsWith('harness:')
                ? {
                    provider: decode(agentSchema.fields.provider, value.slice(8)),
                    endpoint: '',
                  }
                : undefined,
            model: '',
            reasoning: '',
          })
        }}
      />
      {!(selection && settings.inheritTitleModel) && agent.provider === 'acp' && (
        <AcpRegistry
          agent={agent}
          onChange={(agent) => setSettings({ ...settings, ...titleSettingsForHarness(agent) })}
        />
      )}
      {!(selection && settings.inheritTitleModel) && (
        <ModelSettings
          serviceTier={false}
          disabled={busy || (selection && !!settings.inheritTitleModel)}
          agent={agent}
          onChange={(agent) =>
            setSettings({
              ...settings,
              model: agent.model,
              reasoning: agent.reasoning ?? '',
            })
          }
        />
      )}
      {settings.harness &&
        !(selection && settings.inheritTitleModel) &&
        (agent.provider === 'acp' || agent.provider === 'opencode') && (
          <Field
            label={uiText('Title harness endpoint')}
            editable={!busy}
            value={settings.harness.endpoint}
            onChangeText={(endpoint) =>
              setSettings({
                ...settings,
                harness: {
                  ...settings.harness!,
                  endpoint,
                },
              })
            }
          />
        )}
      {!(selection && settings.inheritTitleModel) && settings.harness?.provider === 'acp' && (
        <Field
          label={uiText('Title ACP arguments')}
          editable={!busy}
          value={settings.harness.args?.join('\n') ?? ''}
          multiline
          onChangeText={(args) =>
            setSettings({
              ...settings,
              harness: {
                ...settings.harness!,
                args: args.split('\n').filter(Boolean),
              },
            })
          }
        />
      )}
      {selection && (
        <View style={{ gap: 12 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={uiText('Additional prompts (optional)')}
            accessibilityState={{ expanded: promptsOpen }}
            onPress={() => setPromptsOpen(!promptsOpen)}
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <Text style={styles.text}>
              <InterfaceText values={{ value0: promptsOpen ? '▾' : '▸' }}>
                {'{value0} Additional prompts (optional)'}
              </InterfaceText>
            </Text>
          </Pressable>
          {promptsOpen && (
            <>
              <Text style={styles.muted}>
                <InterfaceText>
                  {
                    'Add preferences to the built-in selection instructions. Leave blank to use defaults.'
                  }
                </InterfaceText>
              </Text>
              {(
                [
                  ['scopePrompt', 'Scope'],
                  ['tunePrompt', 'Tune'],
                  ['maestroPrompt', 'Maestro'],
                ] as const
              ).map(([key, label]) => (
                <Field
                  key={key}
                  label={uiText('{value0} additional prompt', { value0: label })}
                  multiline
                  maxLength={12000}
                  editable={!busy}
                  value={settings[key] ?? ''}
                  onChangeText={(value) => setSettings({ ...settings, [key]: value || undefined })}
                />
              ))}
            </>
          )}
        </View>
      )}
      <SettingsSaveBar
        inline
        dirty={dirty}
        saving={busy}
        saved={saved}
        changes={settingsChanges(baseline ?? {}, settings)}
        saveError={error}
        readLatestChanges={async () =>
          settingsChanges(
            baseline ?? {},
            await call(`${settingsPath}/read`, {}, titleGenerationSettingsSchema),
          )
        }
        onDiscard={() => {
          setSettings(baseline)
          setSaved(false)
        }}
        saveLabel={selection ? 'Save selection model' : 'Save title settings'}
        disabled={
          !connected ||
          busy ||
          !baseline ||
          JSON.stringify(settings) === JSON.stringify(baseline) ||
          (!settings.generator &&
            !(selection && settings.inheritTitleModel) &&
            (!settings.model.trim() || (!settings.harness && !settings.agentId)))
        }
        onSave={() =>
          act(() =>
            mobileWorkflow(function* () {
              const saved = yield* callEffect(
                `${settingsPath}/save`,
                { before: baseline, after: settings },
                titleGenerationSettingsSchema,
              )
              setSettings(saved)
              setBaseline(saved)
              setSaved(true)
            }),
          )
        }
      />
      {saved && (
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          {selection
            ? uiText('Selection model settings saved.')
            : uiText('Title settings saved. Applies to new titles and dictation cleanup.')}
        </Text>
      )}
      {!!error && (
        <>
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
          <Action
            secondary
            label={uiText('Reload settings')}
            disabled={!connected || busy}
            onPress={() => {
              const reload = () => {
                protectDraft.current = false
                setSettings(undefined)
                setRetry((value) => value + 1)
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
        </>
      )}
    </View>
  )
}
