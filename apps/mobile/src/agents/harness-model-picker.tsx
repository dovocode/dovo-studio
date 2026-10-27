import { Fragment, useEffect, useState, type ReactNode } from 'react'
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
import { Action } from '../ui/controls/action'
import { Icon } from '../ui/controls/icon'
import { HarnessIcon } from './harness-icon'
import { useCachedModelCatalog, useModelCatalog } from './use-model-catalog'
import { harnessNames, selectedTaskHarness } from '../tasks/creation/harness-choices'

type Choice = { id: string; name: string; provider: Agent['provider'] }
type Tab = 'models' | 'favorites' | 'agents'
// Large catalogues (e.g. OpenRouter) render progressively; search reaches the rest.
const pageSize = 40
// Catalogue IDs are only worth a line when they say more than the display name.
const plain = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '')
const tabs: { id: Tab; name: string }[] = [
  { id: 'models', name: 'Models' },
  { id: 'favorites', name: 'Favorites' },
  { id: 'agents', name: 'Agents' },
]

/**
 * Phone-first harness/model browser: a separate provider view filters full-width rows; only rows
 * (models, saved agents, custom IDs) save. Rows flow inside the caller's scrolling sheet rather
 * than a nested fixed-height list. While disabled, harnesses, search and favorites stay usable;
 * only changing the task's selection is blocked. Favorites here are the selected computer's
 * (server-scope) preferences, shared by every task on it.
 */
export function HarnessModelPicker(props: PickerProps) {
  const { profile } = useRuntime()
  // Browse, favorite and error state belongs to one computer. Switching computers starts a fresh
  // picker, so a late favorite response from the previous one only reaches the unmounted picker.
  return (
    <ComputerModelPicker
      key={`${profile?.id ?? ''}\n${profile?.connection.address ?? ''}`}
      {...props}
    />
  )
}
type PickerProps = {
  task: Task
  agents: Agent[]
  choices: Choice[]
  selection: string
  agent: Agent
  disabled: boolean
  modelsOnly?: boolean
  onChange: (selection: string, agent: Agent) => void
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
  const [browse, setBrowse] = useState(selection)
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<Tab>('models')
  const [custom, setCustom] = useState(false)
  const [customId, setCustomId] = useState('')
  const [limit, setLimit] = useState(pageSize)
  const [choosingProvider, setChoosingProvider] = useState(false)
  const [providerQuery, setProviderQuery] = useState('')
  const active =
    choices.find((choice) => choice.id === browse) ??
    choices.find((choice) => choice.id === selection)
  const browsingCurrent = active?.id === selection
  const candidate = browsingCurrent
    ? agent
    : ((active && selectedTaskHarness(task, agents, active.id, snapshot?.acpInstallations)) ??
      agent)
  const { catalog, loading, error, refresh, canDiscover } = useModelCatalog(candidate)
  const selectedCatalog = useCachedModelCatalog(agent, profile ?? undefined)
  const [savedPreferences, setSavedPreferences] = useState<RuntimeDefaults['modelPreferences']>()
  const [preferenceError, setPreferenceError] = useState('')
  const [savingFavorite, setSavingFavorite] = useState(false)
  const snapshotPreferences = JSON.stringify(snapshot?.defaults?.modelPreferences ?? {})
  useEffect(() => setSavedPreferences(undefined), [snapshotPreferences])
  const preferences = savedPreferences ?? snapshot?.defaults?.modelPreferences ?? {}
  const key = (id: string) =>
    modelPreferenceKey(candidate.provider, id, candidate.acpInstallationId)
  const favorite = (id: string) => !!preferences[key(id)]?.favorite
  const search = query.trim().toLowerCase()
  const matches = (...text: (string | undefined)[]) =>
    !search || text.some((value) => value?.toLowerCase().includes(search))
  const models = modelCatalogChoices(catalog?.models ?? [])
    .filter(
      (model) =>
        isNamedModelId(model.id) &&
        ((!model.hidden && !preferences[key(model.id)]?.disabled) ||
          model.id === candidate.model) &&
        (tab !== 'favorites' || favorite(model.id)) &&
        matches(model.name, model.id),
    )
    .sort((a, b) => Number(favorite(b.id)) - Number(favorite(a.id)))
  const savedAgents = choices.filter((choice) => choice.id.startsWith('agent:'))
  const matchingAgents = savedAgents.filter((choice) => matches(choice.name))
  // Saved agents appear beside harnesses only while they are selected or being browsed.
  const harnesses = choices.filter(
    (choice) =>
      !choice.id.startsWith('agent:') || choice.id === selection || choice.id === active?.id,
  )
  const otherHarnesses = search
    ? harnesses.filter((choice) => choice.id !== active?.id && matches(choice.name))
    : []
  const customModel =
    tab === 'models' &&
    isNamedModelId(candidate.model) &&
    !catalog?.models.some((model) => model.id === candidate.model) &&
    matches(candidate.model, modelDisplayName(candidate.model))
  const typed = query.trim()
  // An unknown ID can be used straight from search instead of reopening the custom field.
  const customSearch =
    tab === 'models' &&
    isNamedModelId(typed) &&
    !/\s/.test(typed) &&
    !models.length &&
    !(customModel && candidate.model === typed)
  const shownModels = models.filter(
    (model, index) => index < limit || (browsingCurrent && model.id === agent.model),
  )
  const harnessName = active?.name ?? harnessNames[candidate.provider]
  const currentName = choices.find((choice) => choice.id === selection)?.name ?? agent.name
  const currentModel = agent.model ? selectedCatalog.modelName : 'Provider default'
  const computer = profile?.name || 'this computer'

  const filter = (text: string) => {
    setQuery(text)
    setLimit(pageSize)
  }
  const browseTo = (id: string) => {
    setBrowse(id)
    setChoosingProvider(false)
    setTab('models')
    filter('')
    setCustom(false)
  }
  const choose = (model: string) => {
    if (disabled || !active) return
    onChange(active.id, {
      ...candidate,
      model,
      reasoning: model === candidate.model ? candidate.reasoning : '',
      serviceTier: model === candidate.model ? candidate.serviceTier : undefined,
      cyberAccessProgram: model === candidate.model ? candidate.cyberAccessProgram : undefined,
    })
  }
  const chooseAgent = (id: string) => {
    if (disabled) return
    const next = selectedTaskHarness(task, agents, id, snapshot?.acpInstallations)
    if (!next) return
    setBrowse(id)
    onChange(id, next)
  }
  const toggleFavorite = (id: string) => {
    setSavingFavorite(true)
    void runClientEffect(
      callEffect(
        '/api/agents/models/preference',
        { key: key(id), favorite: !favorite(id) },
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
  // Return activates the search's only selectable row: one model, agent or custom ID.
  const submitSearch = () => {
    if (tab === 'agents') {
      if (matchingAgents.length === 1) chooseAgent(matchingAgents[0].id)
    } else if (otherHarnesses.length) return
    else if (search && models.length === 1 && !customModel) choose(models[0].id)
    else if (customSearch) choose(typed)
  }

  const row = ({
    id,
    label,
    title,
    detail,
    identifier,
    selected,
    onPress,
    provider,
    hint,
    trailing,
  }: {
    id: string
    label: string
    title: string
    detail?: string
    identifier?: string
    selected: boolean
    onPress: () => void
    provider?: Agent['provider']
    hint?: string
    trailing?: ReactNode
  }) => (
    <View
      key={id}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 12,
        backgroundColor: selected ? colors.selection : 'transparent',
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityState={{ selected, disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => ({
          flex: 1,
          minWidth: 0,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          minHeight: 44,
          paddingLeft: 12,
          paddingRight: trailing ? 4 : 12,
          paddingVertical: 6,
          borderRadius: 12,
          opacity: pressed ? 0.6 : disabled && !selected ? 0.6 : 1,
        })}
      >
        {provider && <HarnessIcon provider={provider} size={20} />}
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text
            numberOfLines={2}
            style={{
              color: colors.text,
              fontSize: 16,
              lineHeight: 21,
              fontWeight: selected ? '600' : '400',
            }}
          >
            {title}
          </Text>
          {!!detail && (
            <Text numberOfLines={2} style={[styles.muted, { fontSize: 13 }]}>
              {detail}
            </Text>
          )}
          {/* IDs distinguish catalogue entries whose names or descriptions coincide. */}
          {!!identifier && (
            <Text numberOfLines={2} ellipsizeMode="middle" style={[styles.muted, { fontSize: 12 }]}>
              {identifier}
            </Text>
          )}
        </View>
        {selected && (
          <Text
            accessible={false}
            style={{ color: colors.accent, fontSize: 17, fontWeight: '700' }}
          >
            ✓
          </Text>
        )}
      </Pressable>
      {trailing}
    </View>
  )
  const empty = (message: string) => (
    <Text style={[styles.muted, { paddingHorizontal: 12, paddingVertical: 10 }]}>{message}</Text>
  )

  if (choosingProvider) {
    const providers = harnesses.filter((choice) =>
      choice.name.toLowerCase().includes(providerQuery.trim().toLowerCase()),
    )
    return (
      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to models"
            onPress={() => setChoosingProvider(false)}
            style={({ pressed }) => ({
              minWidth: 44,
              minHeight: 44,
              justifyContent: 'center',
              alignItems: 'center',
              borderRadius: 12,
              backgroundColor: pressed ? colors.selection : 'transparent',
            })}
          >
            <Icon name="back" size={20} color={colors.text} />
          </Pressable>
          <Text
            accessibilityRole="header"
            style={{ color: colors.text, fontSize: 17, fontWeight: '600', flex: 1 }}
          >
            Choose provider
          </Text>
        </View>
        <SearchField
          label="Search providers"
          placeholder="Find a provider…"
          value={providerQuery}
          onChangeText={setProviderQuery}
        />
        <Text style={[styles.muted, { fontSize: 13, paddingHorizontal: 4 }]}>
          Browse models on {computer}. Your selection changes when you choose a model.
        </Text>
        <View style={{ borderRadius: 12, overflow: 'hidden', backgroundColor: colors.surface }}>
          {providers.map((choice, index) => (
            <Pressable
              key={choice.id}
              accessibilityRole="button"
              accessibilityLabel={choice.name}
              accessibilityState={{ selected: choice.id === active?.id }}
              accessibilityHint="Show this provider’s models"
              onPress={() => browseTo(choice.id)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                minHeight: 52,
                padding: 12,
                backgroundColor: pressed ? colors.selection : 'transparent',
                borderTopWidth: index ? 1 : 0,
                borderTopColor: colors.border,
              })}
            >
              <HarnessIcon provider={choice.provider} size={22} />
              <Text style={{ color: colors.text, fontSize: 16, flex: 1, minWidth: 0 }}>
                {choice.name}
              </Text>
              {choice.id === active?.id && <Icon name="check" size={18} color={colors.accent} />}
            </Pressable>
          ))}
        </View>
        {!providers.length && empty('No matching providers.')}
      </View>
    )
  }

  return (
    <View style={{ gap: 8 }}>
      <View
        accessible
        accessibilityLabel={`Selected on ${computer}: ${currentName}, ${currentModel}`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          padding: 10,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
        }}
      >
        <HarnessIcon provider={agent.provider} size={20} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text numberOfLines={2} style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>
            {currentModel}
          </Text>
          <Text numberOfLines={2} style={[styles.muted, { fontSize: 13 }]}>
            {currentName} · {computer}
          </Text>
        </View>
      </View>

      <View
        accessibilityRole="tablist"
        style={{
          flexDirection: 'row',
          padding: 2,
          borderRadius: 12,
          backgroundColor: colors.surface,
        }}
      >
        {tabs
          .filter((item) => !modelsOnly || item.id !== 'agents')
          .map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="tab"
              accessibilityLabel={item.name}
              accessibilityState={{ selected: tab === item.id }}
              onPress={() => {
                setTab(item.id)
                filter('')
                setCustom(false)
              }}
              style={({ pressed }) => ({
                flex: 1,
                minWidth: 0,
                minHeight: 44,
                paddingHorizontal: 6,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 10,
                backgroundColor: tab === item.id ? colors.selection : 'transparent',
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text
                numberOfLines={1}
                style={{
                  fontSize: 14,
                  fontWeight: '600',
                  color: tab === item.id ? colors.text : colors.muted,
                }}
              >
                {item.name}
              </Text>
            </Pressable>
          ))}
      </View>

      {tab !== 'agents' && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose provider"
          accessibilityValue={{ text: harnessName }}
          accessibilityHint="Browse another provider without changing the selected model"
          onPress={() => {
            setProviderQuery('')
            setChoosingProvider(true)
          }}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            minHeight: 48,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 12,
            backgroundColor: pressed ? colors.selection : colors.surface,
          })}
        >
          <Text style={[styles.muted, { fontSize: 13 }]}>Provider</Text>
          <View
            style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 }}
          >
            <HarnessIcon provider={candidate.provider} size={18} />
            <Text style={{ color: colors.text, fontSize: 15, flexShrink: 1 }}>{harnessName}</Text>
          </View>
          <Icon name="next" size={16} color={colors.muted} />
        </Pressable>
      )}

      <SearchField
        label="Search harnesses and models"
        placeholder={
          tab === 'agents'
            ? 'Search saved agents…'
            : tab === 'favorites'
              ? `Search ${harnessName} favorites…`
              : `Search ${harnessName} models…`
        }
        value={query}
        onChangeText={filter}
        onSubmitEditing={submitSearch}
      />

      <Text style={[styles.muted, { paddingHorizontal: 4 }]}>
        {tab === 'agents'
          ? `Saved agents available on ${computer}.`
          : tab === 'favorites'
            ? `${harnessName} favorites saved on ${computer}, shared by all its tasks.`
            : browsingCurrent
              ? `${harnessName} models on ${computer}.`
              : `Browsing ${harnessName} on ${computer}.${disabled ? '' : ' Choose a model to switch.'}`}
      </Text>

      <View
        accessibilityLabel={tab === 'agents' ? 'Saved agents' : 'Available models'}
        style={{ gap: 2 }}
      >
        {tab === 'agents' ? (
          <>
            {!matchingAgents.length &&
              empty(
                savedAgents.length
                  ? 'No matching saved agents.'
                  : 'No saved agents. Create one in Settings.',
              )}
            {matchingAgents.map((choice) =>
              row({
                id: choice.id,
                label: choice.name,
                title: choice.name,
                selected: selection === choice.id,
                onPress: () => chooseAgent(choice.id),
                provider: choice.provider,
                hint: 'Uses this saved agent',
              }),
            )}
          </>
        ) : (
          <>
            {otherHarnesses.map((choice) =>
              row({
                id: `browse:${choice.id}`,
                label: `Browse ${choice.name} models`,
                title: choice.name,
                detail: 'Show models',
                selected: false,
                onPress: () => browseTo(choice.id),
                provider: choice.provider,
              }),
            )}
            {shownModels.map((model, index) => (
              <Fragment key={model.id}>
                {tab === 'models' &&
                  !search &&
                  (index === 0 || favorite(shownModels[index - 1].id) !== favorite(model.id)) && (
                    <Text
                      accessibilityRole="header"
                      style={[
                        styles.muted,
                        {
                          paddingHorizontal: 12,
                          paddingTop: 10,
                          paddingBottom: 4,
                          fontSize: 13,
                          fontWeight: '600',
                        },
                      ]}
                    >
                      {favorite(model.id)
                        ? 'Favorites'
                        : models.some((item) => favorite(item.id))
                          ? 'Other models'
                          : 'All models'}
                    </Text>
                  )}
                {row({
                  id: model.id,
                  label: model.name,
                  title: model.name,
                  detail:
                    model.description && plain(model.description) !== plain(model.name)
                      ? model.description
                      : undefined,
                  identifier: plain(model.id) !== plain(model.name) ? model.id : undefined,
                  selected: browsingCurrent && agent.model === model.id,
                  onPress: () => choose(model.id),
                  trailing: (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${favorite(model.id) ? 'Unfavorite' : 'Favorite'} ${model.name}`}
                      accessibilityHint={`Saved on ${computer}`}
                      accessibilityState={{ selected: favorite(model.id) }}
                      disabled={!connected || savingFavorite}
                      hitSlop={4}
                      onPress={() => toggleFavorite(model.id)}
                      style={({ pressed }) => ({
                        width: 44,
                        minHeight: 44,
                        alignItems: 'center',
                        justifyContent: 'center',
                        opacity: !connected ? 0.4 : pressed ? 0.6 : 1,
                      })}
                    >
                      <Text
                        style={{
                          fontSize: 20,
                          color: favorite(model.id) ? colors.accent : colors.muted,
                        }}
                      >
                        {favorite(model.id) ? '★' : '☆'}
                      </Text>
                    </Pressable>
                  ),
                })}
              </Fragment>
            ))}
            {customModel &&
              row({
                id: 'saved',
                label: `${modelDisplayName(candidate.model)} (saved/custom)`,
                title: modelDisplayName(candidate.model),
                detail: 'Saved custom model',
                identifier: candidate.model,
                selected: browsingCurrent,
                onPress: () => choose(candidate.model),
              })}
            {customSearch &&
              row({
                id: 'search-custom',
                label: `Use custom model ${typed}`,
                title: `Use “${typed}”`,
                detail: `Custom ${harnessName} model ID`,
                selected: false,
                onPress: () => choose(typed),
              })}
            {models.length > shownModels.length && (
              <Action
                secondary
                label={`Show ${Math.min(pageSize, models.length - shownModels.length)} more models`}
                onPress={() => setLimit(limit + pageSize)}
              />
            )}
            {loading && empty('Loading models…')}
            {!loading &&
              !models.length &&
              !customModel &&
              !customSearch &&
              !otherHarnesses.length &&
              empty(
                tab === 'favorites'
                  ? search
                    ? 'No matching favorites.'
                    : 'No favorite models for this harness.'
                  : 'No matching models.',
              )}
          </>
        )}
      </View>

      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {!!preferenceError && (
        <Text accessibilityRole="alert" style={styles.error}>
          {preferenceError}
        </Text>
      )}
      {tab !== 'agents' && (
        <>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              borderTopWidth: 1,
              borderTopColor: colors.border,
              paddingTop: 4,
            }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Action
                secondary
                label="Custom model…"
                disabled={disabled}
                onPress={() => {
                  setCustom(!custom)
                  setCustomId(candidate.model)
                }}
              />
            </View>
            {!connected && !!catalog && (
              <Text style={[styles.muted, { flexShrink: 1 }]}>Offline · saved list</Text>
            )}
            <Action
              secondary
              label="Refresh models"
              disabled={loading || !canDiscover}
              onPress={refresh}
            />
          </View>
          {custom && (
            <View style={{ gap: 8 }}>
              <SearchField
                label="Custom model ID"
                placeholder={`${harnessName} model ID`}
                value={customId}
                onChangeText={setCustomId}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (customId.trim()) choose(customId.trim())
                }}
              />
              <Action
                label="Use model"
                wide
                disabled={disabled || !customId.trim()}
                onPress={() => choose(customId.trim())}
              />
            </View>
          )}
        </>
      )}
    </View>
  )
}
