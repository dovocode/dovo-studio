import { mobileWorkflow, nativeEffect } from '../runtime/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from '../runtime/application-state'
import { useEffect, useRef } from 'react'
import { Linking, View } from 'react-native'
import { Text } from '../ui/text'
import {
  managedSkillSchema,
  registryCatalogSchema,
  skillCatalogSchema,
  type RegistryEntry,
  type SkillCatalogEntry,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { Sheet } from '../ui/sheet'
import { Action } from '../ui/action'
import { Field } from '../ui/field'
import { Choice } from '../ui/choice'
import { styles } from '../ui/theme'
import { useAction } from '../ui/use-action'
import type { ResourceSelection } from './editor'
export function CatalogPicker({
  kind,
  scope,
  onClose,
  onSelect,
}: {
  kind: 'mcp' | 'skill'
  scope: string
  onClose: () => void
  onSelect: (entry: ResourceSelection) => void
}) {
  const { call, callEffect } = useRuntime(),
    { act, busy, error } = useAction()
  const [query, setQuery] = useApplicationState(''),
    [servers, setServers] = useApplicationState<RegistryEntry[]>([]),
    [skills, setSkills] = useApplicationState<SkillCatalogEntry[]>([]),
    [cursor, setCursor] = useApplicationState<string | undefined>(undefined),
    [selected, setSelected] = useApplicationState<RegistryEntry | undefined>(undefined),
    [variantId, setVariantId] = useApplicationState(''),
    [loading, setLoading] = useApplicationState(false),
    [loadError, setLoadError] = useApplicationState('')
  const generation = useRef(0)
  useEffect(() => {
    const id = ++generation.current
    setServers([])
    setSkills([])
    setCursor(undefined)
    setLoadError('')
    if (kind === 'skill' && query.trim().length < 2) {
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
                },
                registryCatalogSchema,
              )
              if (id === generation.current) {
                setServers(result.entries)
                setCursor(result.cursor)
              }
            } else {
              const result = yield* callEffect(
                '/api/agents/catalogs/skills',
                {
                  query,
                },
                skillCatalogSchema,
              )
              if (id === generation.current) setSkills(result.entries)
            }
          }).pipe(
            Effect.catchAll((error) =>
              nativeEffect(() => {
                if (id === generation.current) setLoadError(String(error))
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
  }, [kind, query, call])
  const variant = selected?.variants.find((item) => item.id === variantId)
  return (
    <Sheet title={kind === 'mcp' ? 'MCP Registry' : 'skills.sh'} busy={busy} onClose={onClose}>
      <Text style={styles.muted}>{scope} · Review before saving</Text>
      {selected ? (
        <>
          <Action secondary label="Search results" onPress={() => setSelected(undefined)} />
          <Text style={styles.title}>{selected.name}</Text>
          <Text style={styles.muted}>{selected.description}</Text>
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
          <Field label="Search catalog" value={query} editable={!busy} onChangeText={setQuery} />
          {servers.map((entry) => (
            <View key={entry.name} style={styles.card}>
              <Text style={styles.text}>{entry.name}</Text>
              <Text style={styles.muted}>{entry.description}</Text>
              <Action
                label={`View ${entry.name}`}
                secondary
                onPress={() => {
                  setSelected(entry)
                  setVariantId(
                    (entry.variants.find((item) => item.server) ?? entry.variants[0])?.id ?? '',
                  )
                }}
              />
            </View>
          ))}
          {skills.map((entry) => (
            <View key={`${entry.source}/${entry.id}`} style={styles.card}>
              <Text style={styles.text}>{entry.name}</Text>
              <Text style={styles.muted}>
                {entry.source} · {entry.installs.toLocaleString()} installs
              </Text>
              <Action
                secondary
                label="View source"
                disabled={busy}
                onPress={() => act(() => Linking.openURL(entry.url))}
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
                act(() =>
                  mobileWorkflow(function* () {
                    const result = yield* callEffect(
                      '/api/agents/catalogs/mcp',
                      {
                        query,
                        cursor,
                      },
                      registryCatalogSchema,
                    )
                    if (id === generation.current) {
                      setServers((entries) => [
                        ...new Map(
                          [...entries, ...result.entries].map((entry) => [entry.name, entry]),
                        ).values(),
                      ])
                      setCursor(result.cursor)
                    }
                  }),
                )
              }}
            />
          )}
          {!loading && !servers.length && !skills.length && (
            <Text style={styles.muted}>
              {kind === 'skill' && query.trim().length < 2
                ? 'Type at least two characters to search.'
                : 'No matching entries.'}
            </Text>
          )}
        </>
      )}
      {(loading || busy) && <Text style={styles.muted}>{busy ? 'Working…' : 'Searching…'}</Text>}
      {!!(error || loadError) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error || loadError}
        </Text>
      )}
    </Sheet>
  )
}
