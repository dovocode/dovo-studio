import { supportsUtilities } from '@dovo/protocol'
import { configuredTaskHarness } from '@dovo/protocol'
import { mobileWorkflow, nativeEffect } from '../runtime/state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from '../runtime/state/application-state'
import { decode } from '@dovo/protocol'
import { useEffect } from 'react'
import { View } from 'react-native'
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
  useEffect(() => {
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
            ? 'This computer is offline. Reconnect to load title settings.'
            : loadError || 'Loading title settings…'}
        </Text>
        {!!loadError && (
          <Action
            secondary
            label="Retry title settings"
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
    name: 'Title generator',
    model: settings.model,
    reasoning: settings.reasoning,
  }
  return (
    <View style={styles.card}>
      <Text style={[styles.title, { fontWeight: '600' }]}>
        {selection ? 'AUTO & SMART selector (experimental)' : 'Titles & dictation'}
      </Text>
      <Text style={styles.muted}>
        {selection
          ? 'Selects projects, harnesses and coding models. Inherits the explicit title model unless overridden.'
          : 'Choose an explicit harness and model for task titles and dictation cleanup.'}
      </Text>
      <Choice
        label={selection ? 'AUTO & SMART selector harness' : 'Title harness'}
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
          { id: 'default', name: 'Choose a harness' },
          ...(selection ? [{ id: 'title', name: 'Inherit title model' }] : []),
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
          onChange={(agent) => setSettings(titleSettingsForHarness(agent))}
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
            label="Title harness endpoint"
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
          label="Title ACP arguments"
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
      <Action
        wide
        label={busy ? 'Saving…' : selection ? 'Save selection model' : 'Save title settings'}
        disabled={
          !connected ||
          busy ||
          !baseline ||
          JSON.stringify(settings) === JSON.stringify(baseline) ||
          (!(selection && settings.inheritTitleModel) &&
            (!settings.model.trim() || (!settings.harness && !settings.agentId)))
        }
        onPress={() =>
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
            ? 'Selection model settings saved.'
            : 'Title settings saved. Applies to new titles and dictation cleanup.'}
        </Text>
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  )
}
