import { useEffect, useRef, useState } from 'react'
import { Pressable, View } from 'react-native'
import {
  modelCatalogChoices,
  isNamedModelId,
  modelDisplayName,
  modelPreferenceKey,
  runtimeDefaultsSchema,
  type RuntimeDefaults,
  type Agent,
  type Task,
} from '@dovo/protocol'
import { runClientEffect } from '@dovo/client-runtime'
import { useRuntime } from '../runtime/connection/provider'
import { useTheme } from '../ui/theme'
import { Text } from '../ui/content/text'
import { SearchField } from '../ui/controls/field'
import { Choice as ChoiceControl } from '../ui/controls/choice'
import { Action } from '../ui/controls/action'
import { Icon } from '../ui/controls/icon'
import { HarnessIcon } from './harness-icon'
import { useModelCatalog } from './use-model-catalog'
import { selectedTaskHarness } from '../tasks/creation/harness-choices'

type HarnessChoice = { id: string; name: string; provider: Agent['provider'] }
type PickerProps = {
  task: Task
  agents: Agent[]
  choices: HarnessChoice[]
  selection: string
  agent: Agent
  disabled: boolean
  modelsOnly?: boolean
  onChange: (selection: string, agent: Agent) => void
}
type CatalogActions = { matches: (() => void)[]; refresh: () => void }
const pageSize = 40
const plain = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '')

/** A single native sheet: provider groups, model filters and a separate options section. */
export function HarnessModelPicker(props: PickerProps) {
  const { profile } = useRuntime()
  return (
    <ComputerModelPicker
      key={`${profile?.id ?? ''}\n${profile?.connection.address ?? ''}`}
      {...props}
    />
  )
}
function ComputerModelPicker({
  task,
  agents,
  choices,
  selection,
  agent,
  disabled,
  modelsOnly = false,
  onChange,
}: PickerProps) {
  const { colors, styles } = useTheme()
  const { snapshot, callEffect, connected, profile } = useRuntime()
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [custom, setCustom] = useState(false)
  const [customId, setCustomId] = useState('')
  const catalogs = useRef(new Map<string, CatalogActions>())
  const { catalog, modelName } = useModelCatalog(agent)
  const [savedPreferences, setSavedPreferences] = useState<RuntimeDefaults['modelPreferences']>()
  const [preferenceError, setPreferenceError] = useState('')
  const [savingFavorite, setSavingFavorite] = useState(false)
  const snapshotPreferences = JSON.stringify(snapshot?.defaults?.modelPreferences ?? {})
  useEffect(() => setSavedPreferences(undefined), [snapshotPreferences])
  const preferences = savedPreferences ?? snapshot?.defaults?.modelPreferences ?? {}
  const providers = choices.filter(
    (choice) => !choice.id.startsWith('agent:') || choice.id === selection,
  )
  const savedAgents = choices.filter((choice) => choice.id.startsWith('agent:'))
  const search = query.trim().toLowerCase()
  const computer = profile?.name || 'this computer'
  const selectedModel =
    catalog?.models.find((model) => model.id === agent.model) ??
    (!agent.model ? catalog?.models.find((model) => model.isDefault) : undefined)
  const efforts = selectedModel?.reasoning ?? catalog?.reasoning ?? []
  const customChoice =
    providers.find((choice) => choice.id === filter) ??
    providers.find((choice) => choice.id === selection)
  const customAgent =
    customChoice?.id === selection
      ? agent
      : customChoice
        ? selectedTaskHarness(task, agents, customChoice.id, snapshot?.acpInstallations)
        : undefined
  const choose = (id: string, next: Agent) => {
    if (!disabled) onChange(id, next)
  }
  const applyCustom = () => {
    const model = customId.trim()
    if (!model || !customAgent || !customChoice) return
    choose(customChoice.id, {
      ...customAgent,
      model,
      reasoning: model === customAgent.model ? customAgent.reasoning : '',
      serviceTier: model === customAgent.model ? customAgent.serviceTier : undefined,
      cyberAccessProgram: model === customAgent.model ? customAgent.cyberAccessProgram : undefined,
    })
  }
  const favorite = (candidate: Agent, model: string) =>
    !!preferences[modelPreferenceKey(candidate.provider, model, candidate.acpInstallationId)]
      ?.favorite
  const toggleFavorite = (candidate: Agent, model: string) => {
    if (!connected || savingFavorite) return
    setSavingFavorite(true)
    void runClientEffect(
      callEffect(
        '/api/agents/models/preference',
        {
          key: modelPreferenceKey(candidate.provider, model, candidate.acpInstallationId),
          favorite: !favorite(candidate, model),
        },
        runtimeDefaultsSchema,
      ),
    )
      .then((result) => {
        setSavedPreferences(result.modelPreferences)
        setPreferenceError('')
      })
      .catch((failure: unknown) =>
        setPreferenceError(failure instanceof Error ? failure.message : String(failure)),
      )
      .finally(() => setSavingFavorite(false))
  }
  return (
    <View
      accessibilityLabel={`Selected on ${computer}: ${choices.find((choice) => choice.id === selection)?.name ?? agent.name}, ${agent.model ? modelName : 'Provider default'}`}
      style={{ gap: 12 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <SearchField
            label="Search harnesses and models"
            placeholder="Find a model"
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => {
              const matches = [...catalogs.current.values()].flatMap((entry) => entry.matches)
              if (filter === 'agents') {
                const matches = savedAgents.filter((choice) =>
                  choice.name.toLowerCase().includes(search),
                )
                if (matches.length === 1) {
                  const next = selectedTaskHarness(
                    task,
                    agents,
                    matches[0].id,
                    snapshot?.acpInstallations,
                  )
                  if (next) choose(matches[0].id, next)
                }
              } else if (matches.length === 1) matches[0]?.()
            }}
          />
        </View>
        <View style={{ maxWidth: 144, flexShrink: 1 }}>
          <ChoiceControl
            label="Filter models"
            hideLabel
            compact
            value={filter}
            items={[
              { id: 'all', name: 'All providers' },
              { id: 'favorites', name: 'Favorites' },
              ...(!modelsOnly ? [{ id: 'agents', name: 'Saved agents' }] : []),
              ...providers.map((choice) => ({ id: choice.id, name: choice.name })),
            ]}
            onChange={(value) => {
              setFilter(value)
              setQuery('')
              setCustom(false)
            }}
          />
        </View>
      </View>
      <View
        accessibilityLabel={filter === 'agents' ? 'Saved agents' : 'Available models'}
        style={{ gap: 8 }}
      >
        {filter === 'agents' ? (
          <>
            {savedAgents
              .filter((choice) => !search || choice.name.toLowerCase().includes(search))
              .map((choice) => (
                <Pressable
                  key={choice.id}
                  accessibilityRole="button"
                  accessibilityLabel={choice.name}
                  accessibilityState={{ selected: selection === choice.id, disabled }}
                  disabled={disabled}
                  onPress={() => {
                    const next = selectedTaskHarness(
                      task,
                      agents,
                      choice.id,
                      snapshot?.acpInstallations,
                    )
                    if (next) choose(choice.id, next)
                  }}
                  style={{
                    minHeight: 44,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    padding: 12,
                    borderRadius: 16,
                    backgroundColor: colors.surface,
                  }}
                >
                  <HarnessIcon provider={choice.provider} size={18} />
                  <Text style={{ flex: 1, color: colors.text }}>{choice.name}</Text>
                  {selection === choice.id && <Icon name="check" size={16} color={colors.accent} />}
                </Pressable>
              ))}
            {!savedAgents.some(
              (choice) => !search || choice.name.toLowerCase().includes(search),
            ) && (
              <Text style={styles.muted}>
                {savedAgents.length
                  ? 'No matching saved agents.'
                  : 'No saved agents. Create one in Settings.'}
              </Text>
            )}
          </>
        ) : (
          providers
            .filter((choice) => ['all', 'favorites'].includes(filter) || choice.id === filter)
            .map((choice) => {
              const candidate =
                choice.id === selection
                  ? agent
                  : selectedTaskHarness(task, agents, choice.id, snapshot?.acpInstallations)
              return (
                candidate && (
                  <ProviderModels
                    key={choice.id}
                    choice={choice}
                    candidate={candidate}
                    selected={choice.id === selection}
                    narrowed={filter !== 'all' || !!search}
                    query={query}
                    favoritesOnly={filter === 'favorites'}
                    preferences={preferences}
                    disabled={disabled}
                    favoriteDisabled={!connected || savingFavorite}
                    favorite={favorite}
                    toggleFavorite={toggleFavorite}
                    onChoose={(next) => choose(choice.id, next)}
                    actions={catalogs.current}
                    allowCustom={customChoice?.id === choice.id}
                  />
                )
              )
            })
        )}
      </View>
      {filter !== 'agents' && (efforts.length > 0 || !!agent.reasoning) && (
        <View style={{ gap: 6 }}>
          <Text style={[styles.muted, { fontSize: 13, paddingHorizontal: 4 }]}>Options</Text>
          <ChoiceControl
            row
            label="Reasoning level"
            value={agent.reasoning ?? ''}
            disabled={disabled}
            items={[
              { id: '', name: 'Provider default' },
              ...efforts,
              ...(agent.reasoning && !efforts.some((effort) => effort.id === agent.reasoning)
                ? [{ id: agent.reasoning, name: agent.reasoning }]
                : []),
            ]}
            onChange={(reasoning) => choose(selection, { ...agent, reasoning })}
          />
        </View>
      )}
      {!!preferenceError && (
        <Text accessibilityRole="alert" style={styles.error}>
          {preferenceError}
        </Text>
      )}
      {filter !== 'agents' && (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Action
                secondary
                label="Custom model…"
                disabled={disabled || !customAgent}
                onPress={() => {
                  setCustom(!custom)
                  setCustomId(customAgent?.model ?? '')
                }}
              />
            </View>
            <Action
              secondary
              label="Refresh models"
              disabled={!connected}
              onPress={() => {
                for (const entry of catalogs.current.values()) entry.refresh()
              }}
            />
          </View>
          {custom && customAgent && customChoice && (
            <View style={{ gap: 8 }}>
              <SearchField
                label="Custom model ID"
                placeholder={`${customChoice.name} model ID`}
                value={customId}
                onChangeText={setCustomId}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={applyCustom}
              />
              <Action
                label="Use model"
                disabled={disabled || !customId.trim()}
                onPress={applyCustom}
              />
            </View>
          )}
        </>
      )}
    </View>
  )
}

function ProviderModels({
  choice,
  candidate,
  selected,
  narrowed,
  query,
  favoritesOnly,
  preferences,
  disabled,
  favoriteDisabled,
  favorite,
  toggleFavorite,
  onChoose,
  actions,
  allowCustom,
}: {
  choice: HarnessChoice
  candidate: Agent
  selected: boolean
  narrowed: boolean
  query: string
  favoritesOnly: boolean
  preferences: RuntimeDefaults['modelPreferences']
  disabled: boolean
  favoriteDisabled: boolean
  favorite: (candidate: Agent, model: string) => boolean
  toggleFavorite: (candidate: Agent, model: string) => void
  onChoose: (agent: Agent) => void
  actions: Map<string, CatalogActions>
  allowCustom: boolean
}) {
  const { colors, styles } = useTheme()
  const { connected } = useRuntime()
  const [expanded, setExpanded] = useState(
    selected || ['codex', 'claude'].includes(candidate.provider),
  )
  const [limit, setLimit] = useState(pageSize)
  const open = narrowed || expanded
  const { catalog, loading, error, refresh, canDiscover } = useModelCatalog(candidate, open)
  const search = query.trim().toLowerCase()
  useEffect(() => setLimit(pageSize), [query, favoritesOnly])
  const matches = (...values: string[]) =>
    !search || values.some((value) => value.toLowerCase().includes(search))
  const models = modelCatalogChoices(catalog?.models ?? [])
    .filter(
      (model) =>
        isNamedModelId(model.id) &&
        ((!model.hidden &&
          !preferences?.[
            modelPreferenceKey(candidate.provider, model.id, candidate.acpInstallationId)
          ]?.disabled) ||
          (selected && model.id === candidate.model)) &&
        (!favoritesOnly || favorite(candidate, model.id)) &&
        matches(model.name, model.id, choice.name),
    )
    .sort((a, b) => Number(favorite(candidate, b.id)) - Number(favorite(candidate, a.id)))
  const savedCustom =
    !favoritesOnly &&
    isNamedModelId(candidate.model) &&
    !catalog?.models.some((model) => model.id === candidate.model) &&
    matches(candidate.model, modelDisplayName(candidate.model), choice.name)
  const typed = query.trim()
  const customSearch =
    allowCustom &&
    !favoritesOnly &&
    isNamedModelId(typed) &&
    !/\s/.test(typed) &&
    !models.length &&
    !(savedCustom && candidate.model === typed)
  const choose = (model: string) => {
    if (!disabled)
      onChoose({
        ...candidate,
        model,
        reasoning: model === candidate.model ? candidate.reasoning : '',
        serviceTier: model === candidate.model ? candidate.serviceTier : undefined,
        cyberAccessProgram: model === candidate.model ? candidate.cyberAccessProgram : undefined,
      })
  }
  useEffect(() => {
    if (open)
      actions.set(choice.id, {
        matches: [
          ...models.map((model) => () => choose(model.id)),
          ...(savedCustom ? [() => choose(candidate.model)] : []),
          ...(customSearch ? [() => choose(typed)] : []),
        ],
        refresh: () => {
          if (canDiscover && !loading) refresh()
        },
      })
    else actions.delete(choice.id)
    return () => {
      actions.delete(choice.id)
    }
  })
  const shown = models.filter(
    (model, index) => index < limit || (selected && model.id === candidate.model),
  )
  const rows = [
    ...shown.map((model) => ({ id: model.id, name: model.name })),
    ...(savedCustom
      ? [{ id: candidate.model, name: modelDisplayName(candidate.model), custom: true }]
      : []),
    ...(customSearch ? [{ id: typed, name: `Use “${typed}”`, typed: true }] : []),
  ]
  return (
    <View style={{ gap: 4 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${choice.name} models`}
        accessibilityState={{ expanded: open }}
        onPress={() => setExpanded(!expanded)}
        disabled={narrowed}
        style={{
          minHeight: 44,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 4,
        }}
      >
        <HarnessIcon provider={choice.provider} size={15} />
        <Text style={[styles.muted, { fontSize: 14, fontWeight: '500', flex: 1 }]}>
          {choice.name}
        </Text>
        {!narrowed && (
          <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
            <Icon name="down" size={12} color={colors.muted} />
          </View>
        )}
      </Pressable>
      {open && (
        <>
          <View style={{ backgroundColor: colors.surface, borderRadius: 16, overflow: 'hidden' }}>
            {rows.map((model, index) => (
              <View
                key={model.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 12,
                  borderTopWidth: index ? 1 : 0,
                  borderTopColor: colors.border,
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    'typed' in model
                      ? `Use custom model ${model.id}`
                      : 'custom' in model
                        ? `${model.name} (saved/custom)`
                        : model.name
                  }
                  accessibilityState={{
                    selected: selected && model.id === candidate.model,
                    disabled,
                  }}
                  disabled={disabled}
                  onPress={() => choose(model.id)}
                  style={({ pressed }) => ({
                    flex: 1,
                    minWidth: 0,
                    minHeight: 44,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    paddingVertical: 8,
                    opacity: disabled ? 0.45 : pressed ? 0.6 : 1,
                  })}
                >
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text
                      numberOfLines={1}
                      style={{ fontSize: 16, fontWeight: '500', color: colors.text }}
                    >
                      {model.name}
                    </Text>
                    {plain(model.id) !== plain(model.name) && !('typed' in model) && (
                      <Text numberOfLines={1} style={[styles.muted, { fontSize: 12 }]}>
                        {model.id}
                      </Text>
                    )}
                  </View>
                  {selected && model.id === candidate.model && (
                    <Icon name="check" size={16} color={colors.accent} />
                  )}
                </Pressable>
                {!('typed' in model) && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${favorite(candidate, model.id) ? 'Unfavorite' : 'Favorite'} ${model.name}`}
                    accessibilityState={{
                      selected: favorite(candidate, model.id),
                      disabled: favoriteDisabled,
                    }}
                    disabled={favoriteDisabled}
                    onPress={() => toggleFavorite(candidate, model.id)}
                    style={{
                      width: 44,
                      minHeight: 44,
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: favoriteDisabled ? 0.45 : 1,
                    }}
                  >
                    <Icon
                      name="star"
                      size={18}
                      filled={favorite(candidate, model.id)}
                      color={favorite(candidate, model.id) ? colors.accent : colors.muted}
                    />
                  </Pressable>
                )}
              </View>
            ))}
          </View>
          {models.length > shown.length && (
            <Action
              secondary
              label={`Show ${Math.min(pageSize, models.length - shown.length)} more models`}
              onPress={() => setLimit(limit + pageSize)}
            />
          )}
          {loading && <Text style={styles.muted}>Loading models…</Text>}
          {!loading && !rows.length && (
            <Text style={styles.muted}>
              {favoritesOnly
                ? search
                  ? 'No matching favorites.'
                  : 'No favorite models for this harness.'
                : 'No matching models.'}
            </Text>
          )}
          {!connected && !!catalog && <Text style={styles.muted}>Offline · saved list</Text>}
          {!!error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
        </>
      )}
    </View>
  )
}
