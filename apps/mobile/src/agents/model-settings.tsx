import { Schema } from 'effect'
import { mobileModelCatalogKey } from './model-catalog-cache'
import { useModelCatalog } from './use-model-catalog'
import {
  useMobilePreferences,
  updateMobilePreferences,
} from '../runtime/preferences/app-preferences'
import { runClientEffect } from '@dovo/client-runtime'
import { useApplicationState } from '../runtime/state/application-state'
import { decode } from '@dovo/protocol'
import { View } from 'react-native'
import { Text } from '../ui/content/text'
import {
  agentSchema,
  modelPreferenceKey,
  runtimeDefaultsSchema,
  daybreakChoices,
  modelServiceTiers,
  selectedCatalogModel,
  modelDisplayName,
  modelCatalogChoices,
  serviceTierValue,
  type Agent,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { SettingsChoice as Choice } from '../screens/settings-controls'
import { SettingsField as Field } from '../screens/settings-controls'
import { SettingsAction as Action } from '../screens/settings-controls'
import { useTheme } from '../ui/theme'
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
  const { styles } = useTheme()

  const { connected, callEffect, snapshot, profile, refresh: refreshRuntime } = useRuntime()
  const { catalog, error: discoveryError, loading, canDiscover, refresh } = useModelCatalog(agent)
  const [error, setError] = useApplicationState('')
  const [customSelection, setCustom] = useApplicationState('')
  const customKey = mobileModelCatalogKey(profile ?? undefined, { ...agent, model: '' })
  const custom = customSelection === customKey
  const [manage, setManage] = useApplicationState(false)
  const [saving, setSaving] = useApplicationState(false)
  const [scope, setScope] = useApplicationState('server')
  const { globalModelPreferences, globalModelPreferencesUpdatedAt } = useMobilePreferences()
  const globalPreferences =
    (snapshot?.defaults?.globalModelPreferencesUpdatedAt ?? 0) > globalModelPreferencesUpdatedAt
      ? (snapshot?.defaults?.globalModelPreferences ?? {})
      : (globalModelPreferences ?? snapshot?.defaults?.globalModelPreferences ?? {})
  const preferences =
    scope === 'global' ? globalPreferences : (snapshot?.defaults?.modelPreferences ?? {})
  const preferenceKey = (model: string) =>
    modelPreferenceKey(agent.provider, model, agent.acpInstallationId)
  const allModels = modelCatalogChoices(catalog?.models ?? []).filter(
    (model) => !model.hidden || model.id === agent.model,
  )
  const models = allModels
      .filter(
        (model) => !preferences[preferenceKey(model.id)]?.disabled || model.id === agent.model,
      )
      .slice()
      .sort(
        (a, b) =>
          Number(preferences[preferenceKey(b.id)]?.favorite ?? false) -
          Number(preferences[preferenceKey(a.id)]?.favorite ?? false),
      ),
    selected = selectedCatalogModel(catalog, agent.model),
    efforts =
      selected?.reasoning ??
      (!agent.model || ['acp', 'grok'].includes(agent.provider) ? catalog?.reasoning : []) ??
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
      {!!catalog?.harness && (
        <Text style={styles.muted}>{catalog.harness.name} · Models from this computer</Text>
      )}
      <Action
        secondary
        label={manage ? 'Done managing models' : 'Model visibility & favorites'}
        disabled={disabled}
        onPress={() => setManage(!manage)}
      />
      {manage && (
        <Choice
          label="Model preference scope"
          value={scope}
          onChange={setScope}
          items={[
            { id: 'server', name: 'This server' },
            { id: 'global', name: 'Global · Connected servers' },
          ]}
        />
      )}
      {manage &&
        allModels.map((model) => {
          const key = preferenceKey(model.id)
          const preference = preferences[key]
          const save = (change: { favorite?: boolean; disabled?: boolean }) => {
            if (scope === 'global') {
              updateMobilePreferences({
                globalModelPreferences: {
                  ...globalPreferences,
                  [key]: {
                    favorite: change.favorite ?? globalPreferences[key]?.favorite ?? false,
                    disabled: change.disabled ?? globalPreferences[key]?.disabled ?? false,
                  },
                },
                globalModelPreferencesUpdatedAt: Math.max(
                  Date.now(),
                  globalModelPreferencesUpdatedAt + 1,
                  (snapshot?.defaults?.globalModelPreferencesUpdatedAt ?? 0) + 1,
                ),
              })
              return
            }
            setSaving(true)
            void runClientEffect(
              callEffect(
                '/api/agents/models/preference',
                { key, ...change },
                runtimeDefaultsSchema,
              ),
            )
              .then(() => refreshRuntime())
              .catch((error: unknown) =>
                setError(error instanceof Error ? error.message : String(error)),
              )
              .finally(() => setSaving(false))
          }
          return (
            <View key={model.id} style={styles.row}>
              <Text style={[styles.muted, { flex: 1 }]}>{model.name}</Text>
              <Action
                secondary
                disabled={saving || disabled || !connected}
                label={preference?.favorite ? '★ Favorite' : '☆ Favorite'}
                onPress={() => save({ favorite: !preference?.favorite })}
              />
              <Action
                secondary
                disabled={saving || disabled || !connected}
                label={preference?.disabled ? 'Enable' : 'Disable'}
                onPress={() => save({ disabled: !preference?.disabled })}
              />
            </View>
          )
        })}
      {manage && scope === 'server' && snapshot?.defaults?.globalModelPreferences && (
        <Action
          secondary
          label="Use global model preferences on this server"
          disabled={!connected || saving}
          onPress={() => {
            setSaving(true)
            void runClientEffect(callEffect('/api/agents/models/reset', {}, runtimeDefaultsSchema))
              .then(refreshRuntime)
              .catch((error: unknown) =>
                setError(error instanceof Error ? error.message : String(error)),
              )
              .finally(() => setSaving(false))
          }}
        />
      )}
      {!!models.some((model) => preferences[preferenceKey(model.id)]?.favorite) && (
        <Choice
          row
          label="Favorites"
          disabled={disabled}
          value={agent.model}
          items={models.filter((model) => preferences[preferenceKey(model.id)]?.favorite)}
          onChange={changeModel}
        />
      )}
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
                  name: `${modelDisplayName(agent.model)} (saved/custom)`,
                },
              ]
            : []),
          {
            id: '__custom__',
            name: 'Custom model…',
          },
        ]}
        onChange={(value) => {
          setCustom(value === '__custom__' ? customKey : '')
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
                  ? decode(
                      Schema.required(agentSchema.fields.cyberAccessProgram.schema.schema),
                      program,
                    )
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
        onPress={refresh}
      />
      {!!(error || discoveryError) && (
        <Text style={styles.error}>
          {error || discoveryError} Custom model entry is still available.
        </Text>
      )}
    </View>
  )
}
