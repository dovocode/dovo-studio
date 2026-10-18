import { useEffect, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import {
  modelCatalogChoices,
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
import { HarnessIcon } from './harness-icon'
import { useModelCatalog } from './use-model-catalog'
import { harnessNames, selectedTaskHarness } from '../tasks/creation/harness-choices'

/** Native presentation of the desktop's combined harness/model browser. Browsing never saves. */
export function HarnessModelPicker({
  task,
  agents,
  choices,
  selection,
  agent,
  disabled,
  onChange,
}: {
  task: Task
  agents: Agent[]
  choices: { id: string; name: string; provider: Agent['provider'] }[]
  selection: string
  agent: Agent
  disabled: boolean
  onChange: (selection: string, agent: Agent) => void
}) {
  const { colors, styles } = useTheme()
  const { snapshot, callEffect, connected } = useRuntime()
  const [browse, setBrowse] = useState(selection)
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'models' | 'favorites' | 'agents'>('models')
  const [options, setOptions] = useState(false)
  const [custom, setCustom] = useState(false)
  const [customId, setCustomId] = useState('')
  const active =
    choices.find((choice) => choice.id === browse) ??
    choices.find((choice) => choice.id === selection)
  const candidate =
    active?.id === selection
      ? agent
      : ((active && selectedTaskHarness(task, agents, active.id, snapshot?.acpInstallations)) ??
        agent)
  const { catalog, loading, error, refresh, canDiscover } = useModelCatalog(candidate)
  const [savedPreferences, setSavedPreferences] = useState<RuntimeDefaults['modelPreferences']>()
  const [preferenceError, setPreferenceError] = useState('')
  const [savingFavorite, setSavingFavorite] = useState(false)
  const snapshotPreferences = JSON.stringify(snapshot?.defaults?.modelPreferences ?? {})
  useEffect(() => setSavedPreferences(undefined), [snapshotPreferences])
  const preferences = savedPreferences ?? snapshot?.defaults?.modelPreferences ?? {}
  const key = (id: string) =>
    modelPreferenceKey(candidate.provider, id, candidate.acpInstallationId)
  const models = modelCatalogChoices(catalog?.models ?? [])
    .filter(
      (model) =>
        ((!model.hidden && !preferences[key(model.id)]?.disabled) ||
          model.id === candidate.model) &&
        (tab !== 'favorites' || preferences[key(model.id)]?.favorite) &&
        `${model.name} ${model.id}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(!!preferences[key(b.id)]?.favorite) - Number(!!preferences[key(a.id)]?.favorite),
    )
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
  const row = (
    id: string,
    name: string,
    selected: boolean,
    press: () => void,
    provider?: Agent['provider'],
    subtitle?: string,
  ) => (
    <Pressable
      key={id}
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={press}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 10,
        paddingVertical: 10,
        borderRadius: 10,
        backgroundColor: selected ? colors.selection : 'transparent',
        minHeight: subtitle ? 60 : 44,

        flexShrink: 1,
      }}
    >
      {provider && <HarnessIcon provider={provider} size={18} />}
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ color: colors.text, fontWeight: selected ? '700' : '500', fontSize: 14 }}>
          {name}
        </Text>
        {!!subtitle && <Text style={{ color: colors.muted, fontSize: 12 }}>{subtitle}</Text>}
      </View>
      {selected && !provider && <Text style={{ color: colors.text }}>✓</Text>}
    </Pressable>
  )
  return (
    <View
      style={{
        height: 440,
        flexDirection: 'row',
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 16,
        overflow: 'hidden',
      }}
    >
      <View
        style={{ width: 104, borderRightWidth: 1, borderRightColor: colors.border, padding: 4 }}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={{ flex: 1 }}
        >
          {(['models', 'favorites', 'agents'] as const).map((mode) =>
            row(
              mode,
              { models: 'Models', favorites: 'Favorites', agents: 'Agents' }[mode],
              tab === mode && mode !== 'models',
              () => {
                setTab(mode)
                setQuery('')
              },
            ),
          )}
          <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 6 }} />
          {choices
            .filter((choice) => !choice.id.startsWith('agent:'))
            .map((choice) =>
              row(
                choice.id,
                choice.name,
                tab === 'models' && active?.id === choice.id,
                () => {
                  setBrowse(choice.id)
                  setTab('models')
                  setQuery('')
                  setCustom(false)
                },
                choice.provider,
              ),
            )}
        </ScrollView>
      </View>
      <View style={{ flex: 1, minWidth: 0, padding: 8, gap: 8 }}>
        <Text style={[styles.muted, { fontSize: 11 }]}>Available on this computer</Text>
        <SearchField
          label="Search harnesses and models"
          placeholder={tab === 'agents' ? 'Search agents…' : 'Search models…'}
          value={query}
          onChangeText={setQuery}
        />
        <ScrollView
          keyboardShouldPersistTaps="handled"
          style={{ flex: 1 }}
          contentContainerStyle={{ gap: 2 }}
          accessibilityLabel="Available models"
        >
          {tab === 'agents' ? (
            <>
              {!choices.some(
                (choice) =>
                  choice.id.startsWith('agent:') &&
                  choice.name.toLowerCase().includes(query.toLowerCase()),
              ) && <Text style={styles.muted}>No matching saved agents.</Text>}
              {choices
                .filter(
                  (choice) =>
                    choice.id.startsWith('agent:') &&
                    choice.name.toLowerCase().includes(query.toLowerCase()),
                )
                .map((choice) =>
                  row(
                    choice.id,
                    choice.name,
                    selection === choice.id,
                    () => {
                      const next = selectedTaskHarness(
                        task,
                        agents,
                        choice.id,
                        snapshot?.acpInstallations,
                      )
                      if (next) {
                        setBrowse(choice.id)
                        onChange(choice.id, next)
                      }
                    },
                    choice.provider,
                  ),
                )}
            </>
          ) : (
            <>
              {tab === 'models' &&
                !query &&
                row(
                  'default',
                  'Provider default',
                  active?.id === selection && !agent.model,
                  () => choose(''),
                  undefined,
                  harnessNames[candidate.provider],
                )}
              {models.map((model) => (
                <View key={model.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    {row(
                      model.id,
                      model.name,
                      active?.id === selection && agent.model === model.id,
                      () => choose(model.id),
                      undefined,
                      harnessNames[candidate.provider],
                    )}
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${preferences[key(model.id)]?.favorite ? 'Unfavorite' : 'Favorite'} ${model.name}`}
                    accessibilityState={{ selected: !!preferences[key(model.id)]?.favorite }}
                    disabled={disabled || !connected || savingFavorite}
                    onPress={() => {
                      setSavingFavorite(true)
                      void runClientEffect(
                        callEffect(
                          '/api/agents/models/preference',
                          { key: key(model.id), favorite: !preferences[key(model.id)]?.favorite },
                          runtimeDefaultsSchema,
                        ),
                      )
                        .then((result) => {
                          setSavedPreferences(result.modelPreferences)
                          setPreferenceError('')
                        })
                        .catch((failure: unknown) =>
                          setPreferenceError(
                            failure instanceof Error ? failure.message : String(failure),
                          ),
                        )
                        .finally(() => setSavingFavorite(false))
                    }}
                    style={{
                      minWidth: 36,
                      minHeight: 44,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 20,
                        color: preferences[key(model.id)]?.favorite ? colors.accent : colors.muted,
                      }}
                    >
                      {preferences[key(model.id)]?.favorite ? '★' : '☆'}
                    </Text>
                  </Pressable>
                </View>
              ))}
              {tab === 'models' &&
                candidate.model &&
                !catalog?.models.some((model) => model.id === candidate.model) &&
                row(
                  'saved',
                  `${modelDisplayName(candidate.model)} (saved/custom)`,
                  active?.id === selection,
                  () => choose(candidate.model),
                  undefined,
                  harnessNames[candidate.provider],
                )}
              {loading && <Text style={styles.muted}>Loading models…</Text>}
              {!!error && (
                <Text accessibilityRole="alert" style={styles.error}>
                  {error}
                </Text>
              )}
              {!loading && !models.length && (
                <Text style={styles.muted}>
                  {tab === 'favorites'
                    ? 'No favorite models for this harness.'
                    : 'No matching models.'}
                </Text>
              )}
            </>
          )}
        </ScrollView>
        {!!preferenceError && (
          <Text accessibilityRole="alert" style={styles.error}>
            {preferenceError}
          </Text>
        )}
        {tab !== 'agents' && (
          <>
            <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 4 }}>
              <Action
                secondary
                label={options ? 'Fewer options' : 'More model options'}
                onPress={() => setOptions(!options)}
              />
            </View>
            {options && (
              <View style={{ gap: 4 }}>
                <Action
                  secondary
                  label="Refresh models"
                  disabled={disabled || loading || !canDiscover}
                  onPress={refresh}
                />
                <Action
                  secondary
                  label="Custom model…"
                  disabled={disabled}
                  onPress={() => {
                    setCustom(!custom)
                    setCustomId(candidate.model)
                  }}
                />
                {custom && (
                  <>
                    <SearchField
                      label="Custom model ID"
                      value={customId}
                      onChangeText={setCustomId}
                    />
                    <Action
                      label="Use model"
                      disabled={disabled || !customId.trim()}
                      onPress={() => choose(customId.trim())}
                    />
                  </>
                )}
              </View>
            )}
          </>
        )}
      </View>
    </View>
  )
}
