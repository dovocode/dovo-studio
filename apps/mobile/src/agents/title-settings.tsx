import { mobileWorkflow, nativeEffect } from '../runtime/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from '../runtime/application-state'
import { decode } from '@dovo/protocol'
import { useEffect } from 'react'
import { View } from 'react-native'
import { Text } from '../ui/text'
import {
  agentSchema,
  defaultTaskHarness,
  titleGenerationSettingsSchema,
  type TitleGenerationSettings,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { ModelSettings } from './model-settings'
import { Choice } from '../ui/choice'
import { Field } from '../ui/field'
import { Action } from '../ui/action'
import { styles } from '../ui/theme'
import { useAction } from '../ui/use-action'
export function TitleSettings() {
  const { call, connected, snapshot, callEffect } = useRuntime(),
    { act, busy, error } = useAction()
  const [settings, setSettings] = useApplicationState<TitleGenerationSettings | undefined>(
      undefined,
    ),
    [loadError, setLoadError] = useApplicationState('')
  useEffect(() => {
    let active = true
    if (connected)
      void runClientEffect(
        callEffect('/api/agents/title-settings/read', {}, titleGenerationSettingsSchema)
          .pipe(
            Effect.flatMap((value) =>
              nativeEffect(() => {
                if (active) setSettings(value)
              }),
            ),
          )
          .pipe(
            Effect.catchAll((error) =>
              nativeEffect(() => {
                if (active) setLoadError(String(error))
              }),
            ),
          ),
      )
    return () => {
      active = false
    }
  }, [call, connected])
  if (!settings) return <Text style={styles.muted}>{loadError || 'Loading title settings…'}</Text>
  const saved = snapshot?.workspace.agents.find((agent) => agent.id === settings.agentId)
  const agent = {
    ...defaultTaskHarness('codex'),
    ...(settings.harness ?? saved),
    id: 'title',
    name: 'Title generator',
    model: settings.model,
    reasoning: settings.reasoning,
  }
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Titles & dictation</Text>
      <Text style={styles.muted}>
        This model names new tasks and lightly cleans up dictated text. Cleanup keeps your wording,
        language and code names; it never sends a message.
      </Text>
      <Choice
        label="Title harness"
        value={
          settings.harness
            ? `harness:${settings.harness.provider}`
            : settings.agentId
              ? `agent:${settings.agentId}`
              : 'harness:codex'
        }
        disabled={busy}
        items={[
          ...(['codex', 'claude', 'opencode', 'acp'] as const).map((provider) => ({
            id: `harness:${provider}`,
            name: provider,
          })),
          ...(snapshot?.workspace.agents ?? []).map((agent) => ({
            id: `agent:${agent.id}`,
            name: agent.name,
          })),
        ]}
        onChange={(value) =>
          setSettings({
            ...settings,
            agentId: value.startsWith('agent:') ? value.slice(6) : '',
            harness: value.startsWith('harness:')
              ? {
                  provider: decode(agentSchema.fields.provider, value.slice(8)),
                  endpoint: '',
                }
              : undefined,
            model: '',
            reasoning: '',
          })
        }
      />
      <ModelSettings
        serviceTier={false}
        disabled={busy}
        agent={agent}
        onChange={(agent) =>
          setSettings({
            ...settings,
            model: agent.model,
            reasoning: agent.reasoning ?? '',
          })
        }
      />
      {settings.harness && (agent.provider === 'acp' || agent.provider === 'opencode') && (
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
      {settings.harness?.provider === 'acp' && (
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
        label="Save title settings"
        disabled={!connected || busy}
        onPress={() =>
          act(() =>
            mobileWorkflow(function* () {
              return setSettings(
                yield* callEffect(
                  '/api/agents/title-settings/save',
                  settings,
                  titleGenerationSettingsSchema,
                ),
              )
            }),
          )
        }
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  )
}
