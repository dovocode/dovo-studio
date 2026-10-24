import { contentColumn } from '../ui/layout/content-column'
import { ArtifactSharedBadge } from '../ui/content/artifact-shared-badge'
import {
  artifactLabel,
  artifactFormatLabels,
  runtimeComputerName,
  runtimeReachability,
} from '@dovo/protocol'
import { backToCollection } from '../shell/source-route'
import { useEffect, useEffectEvent, useMemo, useState, useRef } from 'react'
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import {
  artifactLibrarySchema,
  artifactOwnerKey,
  artifactLibraryMemory,
  createRequestGuard,
  loadArtifactSource,
  saveArtifacts,
  type ArtifactSourceState,
  type ArtifactLibraryEntry,
  type RuntimeProfile,
} from '@dovo/protocol'
import { RuntimeScope, useRuntime } from '../runtime/connection/provider'
import { useNavigation } from '../shell/navigation'
import { ArtifactBrowser } from '../ui/content/artifacts'
import { ArtifactSnapshot } from '../ui/content/artifact-snapshot'
import { ArtifactLibraryActions } from '../ui/content/artifact-library-actions'
import { ArtifactFormatIcon } from '../ui/content/artifact-presentation'
import { Text } from '../ui/content/text'
import { SearchField } from '../ui/controls/field'
import { EmptyState } from '../ui/content/empty-state'
import { Choice } from '../ui/controls/choice'
import { Action } from '../ui/controls/action'
import { ScreenHeader } from '../ui/layout/screen-header'
import { useTheme } from '../ui/theme'

type Source = {
  profile: RuntimeProfile
  owner: string
  computerName: string
  connected: boolean
  connecting: boolean
}
type Entry = Source & { artifact: ArtifactLibraryEntry }
export default function ArtifactsScreen() {
  const { colors, styles, highContrast } = useTheme()

  const { overviews, readRuntime, cacheForRuntime } = useRuntime()
  const { focused, navigate } = useNavigation()
  const [query, setQuery] = useState('')
  const [format, setFormat] = useState<ArtifactLibraryEntry['format'] | 'all'>('all')
  const [state, setState] = useState('all')
  const [sort, setSort] = useState('updated')
  const [layout, setLayout] = useState<'preview' | 'list'>('preview')
  const [reload, setReload] = useState(0)
  const [states, setStates] = useState<ReadonlyMap<string, ArtifactSourceState>>(() => new Map())
  const statesRef = useRef(states)
  statesRef.current = states
  const [selected, setSelected] = useState<Entry>()
  const sources: Source[] = useMemo(
    () =>
      overviews
        .filter((entry) => entry.snapshot?.artifactsEnabled)
        .map((entry) => ({
          profile: entry.profile,
          owner: artifactOwnerKey(entry.profile),
          computerName: runtimeComputerName(entry),
          connected: entry.connected,
          connecting: runtimeReachability(entry) === 'connecting',
        })),
    [overviews],
  )
  const [guard] = useState(createRequestGuard)
  const started = useRef(new Map<string, string>())
  const identity = JSON.stringify(
    sources.map((entry) => [entry.owner, entry.connected, entry.connecting]),
  )
  const load = useEffectEvent(() => {
    const owners = new Set(overviews.map((entry) => artifactOwnerKey(entry.profile)))
    artifactLibraryMemory.retain(owners)
    guard.retain(owners)
    setStates((previous) =>
      previous.size === [...previous.keys()].filter((owner) => owners.has(owner)).length
        ? previous
        : new Map([...previous].filter(([owner]) => owners.has(owner))),
    )
    for (const owner of started.current.keys())
      if (!owners.has(owner)) started.current.delete(owner)
    if (!focused) return
    for (const source of sources) {
      const signature = `${source.connected}:${source.connecting}:${reload}`
      if (started.current.get(source.owner) === signature) continue
      started.current.set(source.owner, signature)
      const current = guard.begin(source.owner)
      setStates((previous) =>
        new Map(previous).set(source.owner, {
          status: source.connected || source.connecting ? 'loading' : 'offline',
          saved:
            previous.get(source.owner)?.saved ?? artifactLibraryMemory.recall(source.owner) ?? null,
        }),
      )
      void loadArtifactSource({
        owner: source.owner,
        connected: source.connected,
        read: () =>
          readRuntime(source.profile, '/api/artifacts/library', {}, artifactLibrarySchema),
        cache: () => cacheForRuntime(source.profile),
        current,
      }).then((next) => {
        if (current())
          setStates((previous) =>
            new Map(previous).set(
              source.owner,
              source.connecting ? { status: 'loading', saved: next.saved } : next,
            ),
          )
      })
    }
  })
  useEffect(() => {
    load()
  }, [identity, reload, focused])
  useEffect(
    () => () => {
      guard.cancel()
      started.current.clear()
    },
    [guard],
  )
  const loading = sources.some(
    (source) => (states.get(source.owner)?.status ?? 'loading') === 'loading',
  )
  const entries: Entry[] = sources.flatMap((source) =>
    (states.get(source.owner)?.saved?.artifacts ?? []).map((artifact) => ({ ...source, artifact })),
  )
  const errors = sources.flatMap((source) => {
    const state = states.get(source.owner)
    return state?.status === 'failed' ? [`${source.computerName}: ${state.error}`] : []
  })
  const currentSelection =
    selected &&
    entries.find(
      (entry) =>
        entry.owner === selected.owner &&
        entry.artifact.id === selected.artifact.id &&
        entry.artifact.taskId === selected.artifact.taskId,
    )
  const search = query.trim().toLowerCase()
  const matching = entries.filter(
    ({ artifact, computerName }) =>
      (state === 'all' || artifact.threadState === state) &&
      `${artifact.title} ${artifact.threadTitle} ${artifact.format} ${artifactLabel(artifact)} ${artifact.language ?? ''} ${computerName}`
        .toLowerCase()
        .includes(search),
  )
  const visible = matching
    .filter(({ artifact }) => format === 'all' || artifact.format === format)
    .sort((a, b) =>
      sort === 'title'
        ? a.artifact.title.localeCompare(b.artifact.title, undefined, { numeric: true })
        : (Date.parse(b.artifact.updatedAt) - Date.parse(a.artifact.updatedAt)) *
          (sort === 'oldest' ? -1 : 1),
    )
  const filtered = !!search || format !== 'all' || state !== 'all'
  const clearFilters = () => {
    setQuery('')
    setFormat('all')
    setState('all')
  }
  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Artifacts"
        onBack={() => backToCollection('/')}
        subtitle="Your creations, all in one place."
        buttons={[
          {
            label: layout === 'preview' ? 'List view' : 'Preview view',
            icon: layout === 'preview' ? 'artifactList' : 'preview',
            onPress: () => setLayout((value) => (value === 'preview' ? 'list' : 'preview')),
          },
          {
            label: 'Refresh artifacts',
            icon: 'refresh',
            disabled: loading,
            onPress: () => setReload((value) => value + 1),
          },
        ]}
      />
      <View style={[contentColumn.collection, { paddingHorizontal: 16, paddingTop: 12, gap: 12 }]}>
        <SearchField
          label="Search artifacts"
          placeholder="Search artifacts, threads or computers"
          value={query}
          onChangeText={setQuery}
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {(['all', 'markdown', 'html', 'svg', 'code'] as const).map((value) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityLabel={value === 'all' ? 'All formats' : artifactFormatLabels[value]}
              accessibilityState={{ selected: value === format }}
              onPress={() => setFormat(value)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                minHeight: 44,
                paddingHorizontal: 12,
                borderRadius: 10,
                backgroundColor: value === format ? colors.selection : 'transparent',
                borderWidth: 1,
                borderColor: value === format && highContrast ? colors.text : 'transparent',
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: value === format ? '600' : '400',
                  color: value === format ? colors.text : colors.muted,
                }}
              >
                {value === 'all' ? 'All' : artifactFormatLabels[value]}
              </Text>
              <Text style={{ fontSize: 11, color: colors.muted }}>
                {
                  matching.filter(({ artifact }) => value === 'all' || artifact.format === value)
                    .length
                }
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <Choice
            label="Artifact thread state"
            value={state}
            items={[
              { id: 'all', name: 'All threads' },
              { id: 'active', name: 'Active' },
              { id: 'settled', name: 'Settled' },
              { id: 'archived', name: 'Archived' },
            ]}
            onChange={setState}
            hideLabel
            compact
          />
          <Choice
            label="Sort artifacts"
            value={sort}
            items={[
              { id: 'updated', name: 'Recently updated' },
              { id: 'oldest', name: 'Oldest updated' },
              { id: 'title', name: 'Title A–Z' },
            ]}
            onChange={setSort}
            hideLabel
            compact
          />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }}>
          <Text accessibilityLiveRegion="polite" style={[styles.muted, { flex: 1 }]}>
            {visible.length} {visible.length === 1 ? 'artifact' : 'artifacts'}
            {filtered && ` of ${entries.length}`}
          </Text>
          {filtered && visible.length > 0 && (
            <Action secondary label="Clear filters" onPress={clearFilters} />
          )}
        </View>
        {sources
          .filter((source) => !source.connected && !source.connecting)
          .map((source) => (
            <Text key={source.owner} accessibilityRole="text" style={styles.muted}>
              {source.computerName} is offline.{' '}
              {states.get(source.owner)?.saved
                ? 'Showing saved artifacts.'
                : 'Connect to load its artifacts.'}
            </Text>
          ))}
        {errors.map((error) => (
          <Text key={error} style={styles.error}>
            {error}
          </Text>
        ))}
      </View>
      <FlatList
        data={visible}
        initialNumToRender={6}
        maxToRenderPerBatch={4}
        windowSize={5}
        keyExtractor={({ profile, artifact }) =>
          JSON.stringify([artifactOwnerKey(profile), artifact.taskId, artifact.id])
        }
        refreshing={loading}
        onRefresh={() => setReload((value) => value + 1)}
        contentContainerStyle={[contentColumn.collection, { padding: 16, gap: 12 }]}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <EmptyState
              icon="artifactList"
              title={filtered ? 'No matching artifacts' : 'Your next idea belongs here'}
              description={
                sources.length
                  ? filtered
                    ? 'Try another search or clear your filters.'
                    : 'Ask an agent to create a document, a graphic or an interactive tool. You’ll find it here, across all your threads.'
                  : 'Enable Dovo Artifacts in a computer’s settings to start your collection.'
              }
              action={filtered && <Action secondary label="Clear filters" onPress={clearFilters} />}
            />
          )
        }
        renderItem={({ item }) => (
          <View
            style={{
              borderRadius: 16,
              borderWidth: highContrast ? 1 : StyleSheet.hairlineWidth,
              borderColor: colors.border,
              backgroundColor: colors.surface,
              overflow: 'hidden',
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open artifact ${item.artifact.title}`}
              onPress={() => setSelected(item)}
              style={({ pressed }) => ({
                flexDirection: 'column',
                gap: 12,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              {layout !== 'list' && (
                <ArtifactSnapshot
                  profile={item.profile}
                  artifact={item.artifact}
                  connected={item.connected}
                  connecting={item.connecting}
                  refreshKey={reload}
                />
              )}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  gap: 12,
                  paddingHorizontal: 16,
                  paddingTop: layout === 'list' ? 14 : 0,
                  paddingBottom: 8,
                }}
              >
                {layout === 'list' && <ArtifactFormatIcon format={item.artifact.format} />}
                <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
                  <Text numberOfLines={2} style={[styles.text, { fontWeight: '600' }]}>
                    {item.artifact.title}
                  </Text>
                  <ArtifactSharedBadge artifact={item.artifact} />
                  <Text numberOfLines={1} style={styles.muted}>
                    {item.artifact.threadTitle} · {item.computerName}
                  </Text>
                  <Text style={styles.muted}>
                    {artifactLabel(item.artifact)} · v{item.artifact.revision} ·{' '}
                    {new Date(item.artifact.updatedAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.muted, textTransform: 'capitalize' }}>
                    {item.artifact.threadState}
                  </Text>
                  {item.artifact.deleteAt && (
                    <Text style={styles.error}>
                      Scheduled deletion: {new Date(item.artifact.deleteAt).toLocaleDateString()}
                    </Text>
                  )}
                </View>
              </View>
            </Pressable>
            <ArtifactLibraryActions
              profile={item.profile}
              artifact={item.artifact}
              onOpenSource={() => {
                setSelected(undefined)
                navigate('tasks', item.artifact.taskId, item.profile.id)
              }}
              onDeleted={() => {
                // A library read started before deletion must not restore the deleted card.
                guard.begin(item.owner)
                const saved = statesRef.current.get(item.owner)?.saved
                if (saved) {
                  const artifacts = saved.artifacts.filter(
                    (entry) =>
                      entry.id !== item.artifact.id || entry.taskId !== item.artifact.taskId,
                  )
                  artifactLibraryMemory.remember(item.owner, { ...saved, artifacts })
                  void saveArtifacts(() => cacheForRuntime(item.profile), artifacts)
                  setStates((previous) => {
                    const current = previous.get(item.owner)
                    return current?.saved
                      ? new Map(previous).set(item.owner, {
                          status: item.connected ? 'ready' : 'offline',
                          saved: { ...current.saved, artifacts },
                        })
                      : previous
                  })
                }
                if (
                  selected?.profile.id === item.profile.id &&
                  selected.artifact.id === item.artifact.id
                )
                  setSelected(undefined)
              }}
            />
          </View>
        )}
      />
      {currentSelection && (
        <RuntimeScope runtimeId={currentSelection.profile.id}>
          <ArtifactBrowser
            key={JSON.stringify([
              currentSelection.owner,
              currentSelection.artifact.taskId,
              currentSelection.artifact.id,
            ])}
            taskId={currentSelection.artifact.taskId}
            initialId={currentSelection.artifact.id}
            onClose={() => setSelected(undefined)}
          />
        </RuntimeScope>
      )}
    </View>
  )
}
