import { nativeEffect } from '../runtime/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from '../runtime/application-state'
import { decode } from '@dovo/protocol'
import { useEffect } from 'react'
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
  const { connected, callEffect } = useRuntime()
  const [catalog, setCatalog] = useApplicationState<ModelCatalog | null>(null),
    [error, setError] = useApplicationState(''),
    [loading, setLoading] = useApplicationState(false),
    [refresh, setRefresh] = useApplicationState(0),
    [custom, setCustom] = useApplicationState(false)
  const key = JSON.stringify({
    provider: agent.provider,
    endpoint: agent.endpoint,
    args: agent.args,
    model: agent.provider === 'acp' ? agent.model : '',
    acpInstallationId: agent.provider === 'acp' ? agent.acpInstallationId : undefined,
    acpMode: agent.provider === 'acp' ? agent.acpMode : undefined,
    acpConfig: agent.provider === 'acp' ? agent.acpConfig : undefined,
  })
  const canDiscover =
    connected &&
    (agent.provider !== 'acp' ||
      !!agent.acpInstallationId ||
      !!agent.endpoint.trim() ||
      refresh > 0)
  useEffect(() => {
    let stopped = false
    setCatalog(null)
    setError('')
    setLoading(canDiscover)
    if (!canDiscover) return
    const timer = setTimeout(() => {
      void runClientEffect(
        callEffect('/api/agents/models', JSON.parse(key), modelCatalogSchema)
          .pipe(
            Effect.flatMap((value) =>
              nativeEffect(() => {
                if (!stopped) setCatalog(value)
              }),
            ),
          )
          .pipe(
            Effect.catchAll((error) =>
              nativeEffect(() => {
                if (!stopped) setError(String(error))
              }),
            ),
          )
          .pipe(
            Effect.ensuring(
              nativeEffect(() => {
                if (!stopped) setLoading(false)
              }).pipe(Effect.orDie),
            ),
          ),
      )
    }, 400)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [key, canDiscover, callEffect, refresh])
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
    <View
      style={{
        gap: 12,
      }}
    >
      <Choice
        row
        label="Model"
        disabled={disabled}
        value={custom ? '__custom__' : agent.model}
        items={[
          {
            id: '',
            name: 'Provider default',
          },
          ...models,
          ...(agent.model && !selected
            ? [
                {
                  id: agent.model,
                  name: `${agent.model} (saved/custom)`,
                },
              ]
            : []),
          {
            id: '__custom__',
            name: 'Custom model…',
          },
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
          {
            id: '',
            name: 'Provider default',
          },
          ...efforts,
          ...(agent.reasoning && !efforts.some((e) => e.id === agent.reasoning)
            ? [
                {
                  id: agent.reasoning,
                  name: `${agent.reasoning} (saved)`,
                },
              ]
            : []),
        ]}
        onChange={(reasoning) =>
          onChange({
            ...agent,
            reasoning,
          })
        }
      />
      {serviceTier && agent.provider === 'acp' && catalog?.acp && (
        <>
          {!!catalog.acp.modes.length && (
            <Choice
              row
              label="ACP mode"
              disabled={disabled}
              value={agent.acpMode ?? ''}
              items={[
                { id: '', name: 'Provider default' },
                ...(agent.acpMode && !catalog.acp.modes.some((mode) => mode.id === agent.acpMode)
                  ? [{ id: agent.acpMode, name: `${agent.acpMode} (saved)` }]
                  : []),
                ...catalog.acp.modes,
              ]}
              onChange={(acpMode) => onChange({ ...agent, acpMode: acpMode || undefined })}
            />
          )}
          {catalog.acp.configOptions.map((option) => {
            const value = agent.acpConfig?.[option.id] ?? option.currentValue
            const label = option.category ? `${option.category} · ${option.name}` : option.name
            return option.options.length ? (
              <Choice
                key={option.id}
                row
                label={label}
                disabled={disabled}
                value={value}
                items={[
                  ...(value && !option.options.some((item) => item.id === value)
                    ? [{ id: value, name: `${value} (saved)` }]
                    : []),
                  ...option.options,
                ]}
                onChange={(next) =>
                  onChange({ ...agent, acpConfig: { ...agent.acpConfig, [option.id]: next } })
                }
              />
            ) : (
              <Field
                key={option.id}
                label={label}
                value={value}
                editable={!disabled}
                onChangeText={(next) =>
                  onChange({ ...agent, acpConfig: { ...agent.acpConfig, [option.id]: next } })
                }
              />
            )
          })}
          {!!catalog.acp.commands.length && (
            <Text style={styles.muted}>
              Commands: {catalog.acp.commands.map((command) => command.name).join(' · ')}
            </Text>
          )}
        </>
      )}
      {serviceTier && agent.provider === 'codex' && (
        <>
          <Choice
            row
            label="Speed"
            disabled={disabled}
            value={serviceTierValue(agent.serviceTier)}
            items={modelServiceTiers(catalog, agent.model, agent.serviceTier)}
            onChange={(serviceTier) =>
              onChange({
                ...agent,
                serviceTier,
              })
            }
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
                  ? decode(agentSchema.fields.cyberAccessProgram.from, program)
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
      {connected && agent.provider === 'acp' && !canDiscover && (
        <Text style={styles.muted}>
          Install or select an ACP agent, or enter a custom command to discover its models.
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
