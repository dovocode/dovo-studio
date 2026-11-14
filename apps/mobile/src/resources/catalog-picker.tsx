import { useInterfaceText } from '@dovo/studio-core/interface-language'
import {
  useMobilePreferences,
  updateMobilePreferences,
} from '../runtime/preferences/app-preferences'
import { useOpenAppLink } from '../ui/content/open-link'
import { mobileWorkflow, nativeEffect } from '../runtime/state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from '../runtime/state/application-state'
import { useEffect, useRef } from 'react'
import { View } from 'react-native'
import { Text } from '../ui/content/text'
import {
  catalogSortOptions,
  sortCatalogEntries,
  skillInstallLabel,
  mcpRegistrySources,
  registrySignals,
  managedSkillSchema,
  registryCatalogSchema,
  skillCatalogSchema,
  skillPackageSchema,
  type SkillPackage,
  type ManagedSkill,
  type RegistryEntry,
  type SkillCatalogEntry,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { SettingsSheet as Sheet } from '../screens/settings-theme'
import { SettingsAction as Action } from '../screens/settings-controls'
import { SettingsField as Field } from '../screens/settings-controls'
import { SettingsChoice as Choice } from '../screens/settings-controls'
import { useSettingsTheme as useTheme } from '../screens/settings-theme'
import { useAction } from '../ui/controls/use-action'
import type { ResourceSelection } from './editor'
export function CatalogPicker({
  kind,
  scope,
  onClose,
  onSelect,
  onSkills,
}: {
  kind: 'mcp' | 'skill'
  scope: string
  onClose: () => void
  onSelect: (entry: ResourceSelection) => void
  onSkills: (skills: ManagedSkill[]) => Promise<void>
}) {
  const uiText = useInterfaceText()

  const openLink = useOpenAppLink(undefined)
  const { styles } = useTheme()

  const { call, callEffect } = useRuntime(),
    { act, busy, error } = useAction()
  const { mcpRegistrySource: source } = useMobilePreferences()
  const setSource = (mcpRegistrySource: typeof source) =>
    updateMobilePreferences({ mcpRegistrySource })
  const [view, setView] = useApplicationState('search')
  const [reload, setReload] = useApplicationState(0)
  const [sort, setSort] = useApplicationState('provider')
  const [detailsLoading, setDetailsLoading] = useApplicationState(false)
  const [query, setQuery] = useApplicationState(''),
    [servers, setServers] = useApplicationState<RegistryEntry[]>([]),
    [skills, setSkills] = useApplicationState<SkillCatalogEntry[]>([]),
    [cursor, setCursor] = useApplicationState<string | undefined>(undefined),
    [selected, setSelected] = useApplicationState<RegistryEntry | undefined>(undefined),
    [variantId, setVariantId] = useApplicationState(''),
    [loading, setLoading] = useApplicationState(false),
    [loadError, setLoadError] = useApplicationState('')
  const generation = useRef(0)
  const [bundle, setBundle] = useApplicationState<(SkillPackage & { skill: string }) | null>(null)
  const [chosen, setChosen] = useApplicationState<string[]>([])
  const previewPackage = (entry: SkillCatalogEntry) =>
    act(async () => {
      const result = await call(
        '/api/agents/catalogs/skills/package/preview',
        { source: entry.source, skill: entry.id },
        skillPackageSchema,
      )
      setBundle({ ...result, skill: entry.id })
      setChosen(result.skills.length <= 20 ? result.skills.map((skill) => skill.name) : [entry.id])
    })
  useEffect(() => {
    const id = ++generation.current
    setServers([])
    setSkills([])
    setCursor(undefined)
    setLoadError('')
    if (kind === 'skill' && view === 'search' && query.trim().length < 2) {
      setLoading(false)
      return
    }
    setLoading(true)
    const timer = setTimeout(() => {
      return runClientEffect(
        mobileWorkflow(function* () {
          return yield* mobileWorkflow(function* () {
            if (kind === 'mcp') {
              const result = yield* callEffect(
                '/api/agents/catalogs/mcp',
                {
                  query,
                  source,
                },
                registryCatalogSchema,
              )
              if (source !== 'official' && result.source !== source)
                throw new Error('Update this computer’s runtime to use this MCP registry.')
              if (id === generation.current) {
                setServers(result.entries)
                setCursor(result.cursor)
              }
            } else {
              const result = yield* callEffect(
                '/api/agents/catalogs/skills',
                {
                  query: view === 'search' ? query : '',
                  view,
                },
                skillCatalogSchema,
              )
              if (view !== 'search' && result.view !== view)
                throw new Error('Update this computer’s runtime to browse skill leaderboards.')
              if (id === generation.current) {
                setSkills(result.entries)
                setCursor(result.cursor)
              }
            }
          }).pipe(
            Effect.catch((error) =>
              nativeEffect(() => {
                if (id === generation.current)
                  setLoadError(error instanceof Error ? error.message : String(error))
              }),
            ),
            Effect.ensuring(
              nativeEffect(() => {
                if (id === generation.current) setLoading(false)
              }).pipe(Effect.orDie),
            ),
          )
        }),
      )
    }, 350)
    return () => {
      clearTimeout(timer)
      ++generation.current
    }
  }, [kind, query, source, view, reload, call])
  const variant = selected?.variants.find((item) => item.id === variantId)
  return (
    <Sheet
      title={kind === 'mcp' ? 'MCP Registry' : 'skills.sh'}
      busy={busy || detailsLoading}
      onClose={onClose}
    >
      <Text style={styles.muted}>{scope} · Review before saving</Text>
      {bundle ? (
        <>
          <Action
            secondary
            label="Search results"
            disabled={busy}
            onPress={() => setBundle(null)}
          />
          <Text style={styles.title}>{bundle.source}</Text>
          <Text style={styles.muted}>
            Includes scripts, references and assets. Matching saved skill names will be replaced.
          </Text>
          {bundle.skills.map((skill) => (
            <View key={skill.name} style={styles.card}>
              <Text style={styles.text}>{skill.name}</Text>
              <Text style={styles.muted}>{skill.description}</Text>
              <Action
                secondary
                label={`${chosen.includes(skill.name) ? 'Selected' : 'Select'} ${skill.name}`}
                disabled={busy || (!chosen.includes(skill.name) && chosen.length >= 20)}
                onPress={() =>
                  setChosen(
                    chosen.includes(skill.name)
                      ? chosen.filter((name) => name !== skill.name)
                      : [...chosen, skill.name],
                  )
                }
              />
            </View>
          ))}
          <Action
            label={`Install ${chosen.length} ${chosen.length === 1 ? 'skill' : 'skills'}`}
            disabled={busy || !chosen.length}
            onPress={() =>
              act(async () => {
                const result = await call(
                  '/api/agents/catalogs/skills/package/import',
                  {
                    source: bundle.source,
                    skill: bundle.skill,
                    revision: bundle.revision,
                    skills: chosen,
                  },
                  skillPackageSchema,
                )
                await onSkills(result.skills)
              })
            }
          />
        </>
      ) : selected ? (
        <>
          <Action
            secondary
            label="Search results"
            disabled={detailsLoading}
            onPress={() => setSelected(undefined)}
          />
          <Text style={styles.title}>{selected.name}</Text>
          <Text style={styles.muted}>{selected.description}</Text>
          {registrySignals(selected).map((signal) => (
            <Text key={signal} style={styles.muted}>
              {signal}
            </Text>
          ))}
          <Action
            secondary
            label={
              selected.provider === 'glama'
                ? 'View on Glama'
                : selected.provider === 'smithery'
                  ? 'View on Smithery'
                  : 'View registry entry'
            }
            onPress={() => act(() => openLink(selected.url))}
          />
          {detailsLoading && <Text style={styles.muted}>Loading configuration…</Text>}
          {!detailsLoading && !selected.variants.length && (
            <Text style={styles.muted}>
              Open the provider listing for setup instructions, then add the MCP configuration
              manually.
            </Text>
          )}
          <Choice
            label="Installation variant"
            value={variantId}
            items={selected.variants.map((item) => ({
              id: item.id,
              name: item.label,
            }))}
            onChange={setVariantId}
          />
          {variant?.notes.map((note, i) => (
            <Text key={i} style={styles.muted}>
              {note}
            </Text>
          ))}
          <Action
            label="Configure server"
            disabled={!variant?.server}
            onPress={() => {
              if (variant?.server)
                onSelect({
                  kind: 'mcp',
                  value: variant.server,
                  notes: variant.notes,
                })
            }}
          />
        </>
      ) : (
        <>
          {kind === 'mcp' ? (
            <Choice
              label="MCP registry source"
              value={source}
              items={mcpRegistrySources.map((item) => ({ ...item }))}
              disabled={busy}
              onChange={(value) => {
                const option = mcpRegistrySources.find((item) => item.id === value)
                if (option) {
                  setSource(option.id)
                  setSort('provider')
                }
              }}
            />
          ) : (
            <Choice
              label="Browse skills"
              value={view}
              disabled={busy}
              items={[
                { id: 'search', name: uiText('Search') },
                { id: 'all-time', name: 'All time' },
                { id: 'trending', name: 'Trending (24h)' },
                { id: 'hot', name: 'Hot' },
              ]}
              onChange={(value) => {
                setView(value)
                setSort('provider')
              }}
            />
          )}
          <Choice
            label="Sort loaded results"
            value={sort}
            items={catalogSortOptions[kind]
              .filter((item) => item.id !== 'updated' || source === 'official')
              .filter((item) => item.id !== 'uses' || source === 'smithery')
              .filter((item) => item.id !== 'quality' || source === 'glama')}
            onChange={setSort}
          />
          <Text style={styles.muted}>
            Sorting applies to loaded results. Popularity does not establish safety.
          </Text>
          {kind === 'mcp' && source === 'glama' && (
            <Action
              secondary
              label="MCP data from Glama"
              onPress={() => act(() => openLink('https://glama.ai/mcp/servers'))}
            />
          )}
          <Field
            label="Search catalog"
            value={query}
            editable={!busy && (kind === 'mcp' || view === 'search')}
            onChangeText={setQuery}
          />
          {sortCatalogEntries(servers, sort).map((entry) => (
            <View key={entry.providerId ?? entry.name} style={styles.card}>
              <Text style={styles.text}>{entry.name}</Text>
              <Text style={styles.muted}>{entry.description}</Text>
              {registrySignals(entry).map((signal) => (
                <Text key={signal} style={styles.muted}>
                  {signal}
                </Text>
              ))}
              <Action
                secondary
                label={
                  entry.provider === 'glama'
                    ? 'View on Glama'
                    : entry.provider === 'smithery'
                      ? 'View on Smithery'
                      : 'View registry entry'
                }
                disabled={busy}
                onPress={() => act(() => openLink(entry.url))}
              />
              <Action
                label={`View ${entry.name}`}
                secondary
                disabled={busy}
                onPress={() => {
                  setSelected(entry)
                  setVariantId(
                    (entry.variants.find((item) => item.server) ?? entry.variants[0])?.id ?? '',
                  )
                  if (entry.provider !== 'smithery') return
                  const id = generation.current
                  setDetailsLoading(true)
                  act(async () => {
                    try {
                      const result = await call(
                        '/api/agents/catalogs/mcp',
                        { query: '', source: 'smithery', server: entry.providerId },
                        registryCatalogSchema,
                      )
                      if (result.source !== 'smithery')
                        throw new Error('Update this computer’s runtime to use Smithery.')
                      if (id !== generation.current) return
                      const detail = result.entries[0]
                      if (!detail) throw new Error('The registry did not return this server.')
                      setSelected({ ...entry, variants: detail.variants })
                      setVariantId(
                        (detail.variants.find((item) => item.server) ?? detail.variants[0])?.id ??
                          '',
                      )
                    } finally {
                      if (id === generation.current) setDetailsLoading(false)
                    }
                  })
                }}
              />
            </View>
          ))}
          {sortCatalogEntries(skills, sort).map((entry) => (
            <View key={`${entry.source}/${entry.id}`} style={styles.card}>
              <Text style={styles.text}>{entry.name}</Text>
              <Text style={styles.muted}>
                {entry.source} · {skillInstallLabel(entry)}
              </Text>
              <Text style={styles.muted}>Safety not assessed by Dovo.</Text>
              <Action
                secondary
                label="Review published security audits"
                disabled={busy}
                onPress={() => act(() => openLink(entry.url))}
              />
              <Action
                secondary
                label="View source"
                disabled={busy}
                onPress={() => act(() => openLink(entry.url))}
              />
              <Action
                label={`Install package from ${entry.source}`}
                secondary
                disabled={busy || !entry.supported}
                onPress={() => previewPackage(entry)}
              />
              <Action
                label={`Import ${entry.name}`}
                disabled={busy || !entry.supported}
                onPress={() =>
                  act(() =>
                    mobileWorkflow(function* () {
                      return onSelect({
                        kind: 'skill',
                        value: yield* callEffect(
                          '/api/agents/catalogs/skills/import',
                          {
                            source: entry.source,
                            skill: entry.id,
                          },
                          managedSkillSchema,
                        ),
                      })
                    }),
                  )
                }
              />
              {!entry.supported && (
                <Text style={styles.muted}>Import this source from a local SKILL.md.</Text>
              )}
            </View>
          ))}
          {cursor && (
            <Action
              secondary
              label="Load more"
              disabled={loading || busy}
              onPress={() => {
                const id = generation.current
                act(async () => {
                  if (kind === 'mcp') {
                    const result = await call(
                      '/api/agents/catalogs/mcp',
                      { query, source, cursor },
                      registryCatalogSchema,
                    )
                    if (source !== 'official' && result.source !== source)
                      throw new Error('Update this computer’s runtime to use this MCP registry.')
                    if (id === generation.current) {
                      setServers((entries) => [
                        ...new Map(
                          [...entries, ...result.entries].map((entry) => [
                            entry.providerId ?? entry.name,
                            entry,
                          ]),
                        ).values(),
                      ])
                      setCursor(result.cursor)
                    }
                  } else {
                    const result = await call(
                      '/api/agents/catalogs/skills',
                      { query: view === 'search' ? query : '', view, cursor },
                      skillCatalogSchema,
                    )
                    if (view !== 'search' && result.view !== view)
                      throw new Error(
                        'Update this computer’s runtime to browse skill leaderboards.',
                      )
                    if (id === generation.current) {
                      setSkills((entries) => [
                        ...new Map(
                          [...entries, ...result.entries].map((entry) => [
                            `${entry.source}/${entry.id}`,
                            entry,
                          ]),
                        ).values(),
                      ])
                      setCursor(result.cursor)
                    }
                  }
                })
              }}
            />
          )}
          {!loading && !servers.length && !skills.length && (
            <Text style={styles.muted}>
              {kind === 'skill' && view === 'search' && query.trim().length < 2
                ? 'Type at least two characters to search.'
                : kind === 'mcp' &&
                    source === 'official' &&
                    query.trim().length > 0 &&
                    query.trim().length < 3
                  ? 'Type at least three characters to search the official registry.'
                  : loadError
                    ? 'The catalog could not be loaded.'
                    : 'No matching entries.'}
            </Text>
          )}
        </>
      )}
      {(loading || busy) && <Text style={styles.muted}>{busy ? 'Working…' : 'Searching…'}</Text>}
      {!!loadError && (
        <Action
          secondary
          label="Retry catalog"
          disabled={busy || loading}
          onPress={() => setReload((value) => value + 1)}
        />
      )}
      {!!(error || loadError) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error || loadError}
        </Text>
      )}
    </Sheet>
  )
}
