import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Text } from '../ui/text'
import {
  agentSchema,
  daybreakChoices,
  modelServiceTiers,
  selectedCatalogModel,
  serviceTierValue,
  modelCatalogSchema,
  type ModelCatalog,
  type Agent,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { Choice } from '../ui/choice'
import { Field } from '../ui/field'
import { Action } from '../ui/action'
import { styles } from '../ui/theme'
export function ModelSettings({
  agent,
  onChange,
  serviceTier = true,
  disabled = false,
}: {
  agent: Agent
  serviceTier?: boolean
  disabled?: boolean
  onChange: (agent: Agent) => void
}) {
  const { call, connected } = useRuntime()
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [refresh, setRefresh] = useState(0),
    [custom, setCustom] = useState(false)
  const key = JSON.stringify({
    provider: agent.provider,
    endpoint: agent.endpoint,
    args: agent.args,
    model: agent.provider === 'acp' ? agent.model : '',
  })
  useEffect(() => {
    let stopped = false
    setCatalog(null)
    setError('')
    setLoading(connected)
    if (!connected) return
    const timer = setTimeout(() => {
      void call('/api/agents/models', JSON.parse(key), modelCatalogSchema)
        .then((value) => {
          if (!stopped) setCatalog(value)
        })
        .catch((error) => {
          if (!stopped) setError(String(error))
        })
        .finally(() => {
          if (!stopped) setLoading(false)
        })
    }, 400)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [key, connected, call, refresh])
  const models = catalog?.models ?? [],
    selected = selectedCatalogModel(catalog, agent.model),
    efforts =
      selected?.reasoning ??
      (!agent.model || agent.provider === 'acp' ? catalog?.reasoning : []) ??
      []
  const changeModel = (model: string) =>
    onChange({
      ...agent,
      model,
      reasoning: model === agent.model ? agent.reasoning : '',
      serviceTier: model === agent.model ? agent.serviceTier : undefined,
      cyberAccessProgram: model === agent.model ? agent.cyberAccessProgram : undefined,
    })
  return (
    <View style={{ gap: 12 }}>
      <Choice
        row
        label="Model"
        disabled={disabled}
        value={custom ? '__custom__' : agent.model}
        items={[
          { id: '', name: 'Provider default' },
          ...models,
          ...(agent.model && !selected
            ? [{ id: agent.model, name: `${agent.model} (saved/custom)` }]
            : []),
          { id: '__custom__', name: 'Custom model…' },
        ]}
        onChange={(value) => {
          setCustom(value === '__custom__')
          changeModel(value === '__custom__' ? '' : value)
        }}
      />
      {(custom || (!!agent.model && !selected)) && (
        <Field
          label="Custom model ID"
          value={agent.model}
          editable={!disabled}
          onChangeText={changeModel}
        />
      )}
      <Choice
        row
        label={agent.provider === 'opencode' ? 'Reasoning / model variant' : 'Reasoning level'}
        disabled={disabled}
        value={agent.reasoning ?? ''}
        items={[
          { id: '', name: 'Provider default' },
          ...efforts,
          ...(agent.reasoning && !efforts.some((e) => e.id === agent.reasoning)
            ? [{ id: agent.reasoning, name: `${agent.reasoning} (saved)` }]
            : []),
        ]}
        onChange={(reasoning) => onChange({ ...agent, reasoning })}
      />
      {serviceTier && agent.provider === 'codex' && (
        <>
          <Choice
            row
            label="Speed"
            disabled={disabled}
            value={serviceTierValue(agent.serviceTier)}
            items={modelServiceTiers(catalog, agent.model, agent.serviceTier)}
            onChange={(serviceTier) => onChange({ ...agent, serviceTier })}
          />
          {(catalog?.codex?.fastModeBlocked ||
            serviceTierValue(agent.serviceTier) !== 'default') && (
            <Text style={styles.muted}>
              {catalog?.codex?.fastModeBlocked
                ? 'Fast mode is disabled by the runtime’s managed policy.'
                : modelServiceTiers(catalog, agent.model, agent.serviceTier).find(
                    (tier) => tier.id === serviceTierValue(agent.serviceTier),
                  )?.description}
            </Text>
          )}
          <Choice
            row
            label="Daybreak mode"
            disabled={disabled}
            value={agent.cyberAccessProgram ?? ''}
            items={daybreakChoices(catalog, agent.cyberAccessProgram)}
            onChange={(program) =>
              onChange({
                ...agent,
                cyberAccessProgram: program
                  ? agentSchema.shape.cyberAccessProgram.parse(program)
                  : undefined,
              })
            }
          />
          {!!agent.cyberAccessProgram && agent.cyberAccessProgram !== 'standard' && (
            <Text style={styles.muted}>
              Daybreak applies to each turn. Codex verifies account and model access.
            </Text>
          )}
          {!!catalog && !catalog.codex?.daybreakPrograms.length && (
            <Text style={styles.muted}>
              Daybreak needs an eligible ChatGPT account and an updated Codex harness.
            </Text>
          )}
        </>
      )}
      {(loading || !connected) && (
        <Text style={styles.muted}>
          {loading
            ? 'Loading provider models…'
            : 'Connect to discover models and reasoning levels.'}
        </Text>
      )}
      <Action
        secondary
        label="Refresh models"
        disabled={disabled || !connected || loading}
        onPress={() => setRefresh((value) => value + 1)}
      />
      {!!error && <Text style={styles.error}>{error} Custom model entry is still available.</Text>}
    </View>
  )
}
