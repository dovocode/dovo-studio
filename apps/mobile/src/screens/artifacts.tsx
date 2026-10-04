import { artifactFormatLabels, runtimeComputerName } from '@dovo/protocol'
import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, ScrollView, View } from 'react-native'
import {
  artifactLibrarySchema,
  type ArtifactLibraryEntry,
  type RuntimeProfile,
} from '@dovo/protocol'
import { RuntimeScope, useRuntime } from '../runtime/connection/provider'
import { useNavigation } from '../shell/navigation'
import { ArtifactBrowser } from '../ui/content/artifacts'
import { ArtifactFormatIcon } from '../ui/content/artifact-presentation'
import { Text } from '../ui/content/text'
import { SearchField } from '../ui/controls/field'
import { Icon } from '../ui/controls/icon'
import { Choice } from '../ui/controls/choice'
import { Action } from '../ui/controls/action'
import { ScreenHeader } from '../ui/layout/screen-header'
import { colors, styles } from '../ui/theme'

type Entry = { profile: RuntimeProfile; computerName: string; artifact: ArtifactLibraryEntry }
export default function ArtifactsScreen() {
  const { overviews, readRuntime } = useRuntime()
  const { focused } = useNavigation()
  const [query, setQuery] = useState('')
  const [format, setFormat] = useState<ArtifactLibraryEntry['format'] | 'all'>('all')
  const [state, setState] = useState('all')
  const [reload, setReload] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState<{ identity: string; entries: Entry[]; errors: string[] }>()
  const [selected, setSelected] = useState<Entry>()
  const sources = useMemo(
    () => overviews.filter((entry) => entry.snapshot?.artifactsEnabled),
    [overviews],
  )
  // Streaming text does not change the library's host identity or refetch its metadata.
  const identity = JSON.stringify(
    sources.map((entry) => [
      entry.profile.id,
      runtimeComputerName(entry),
      entry.profile.connection.address,
      entry.profile.connection.token,
      entry.connected,
    ]),
  )
  const load = useEffectEvent(() =>
    Promise.allSettled(
      sources.map(async (entry) => {
        if (!entry.connected) throw new Error(`${runtimeComputerName(entry)}: offline`)
        const result = await readRuntime(
          entry.profile,
          '/api/artifacts/library',
          {},
          artifactLibrarySchema,
        )
        return result.artifacts.map((artifact): Entry => ({
          profile: entry.profile,
          computerName: runtimeComputerName(entry),
          artifact,
        }))
      }),
    ),
  )
  useEffect(() => {
    if (!focused) return
    let stopped = false
    setLoading(true)
    void load().then((results) => {
      if (stopped) return
      setLoaded({
        identity,
        entries: results.flatMap((result) => (result.status === 'fulfilled' ? result.value : [])),
        errors: results.flatMap((result) =>
          result.status === 'rejected' ? [String(result.reason)] : [],
        ),
      })
      setLoading(false)
    })
    return () => {
      stopped = true
    }
  }, [identity, reload, focused])
  const entries = loaded?.identity === identity ? loaded.entries : []
  const errors = loaded?.identity === identity ? loaded.errors : []
  const search = query.trim().toLowerCase()
  const matching = entries.filter(
    ({ artifact, computerName }) =>
      (state === 'all' || artifact.threadState === state) &&
      `${artifact.title} ${artifact.threadTitle} ${artifact.format} ${artifactFormatLabels[artifact.format]} ${artifact.language ?? ''} ${computerName}`
        .toLowerCase()
        .includes(search),
  )
  const visible = matching
    .filter(({ artifact }) => format === 'all' || artifact.format === format)
    .sort((a, b) => Date.parse(b.artifact.updatedAt) - Date.parse(a.artifact.updatedAt))
  const filtered = !!search || format !== 'all' || state !== 'all'
  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Artifacts"
        subtitle="Your creations, all in one place."
        buttons={[
          {
            label: 'Refresh artifacts',
            icon: 'refresh',
            disabled: loading,
            onPress: () => setReload((value) => value + 1),
          },
        ]}
      />
      <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 12 }}>
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
                paddingHorizontal: 14,
                borderRadius: 22,
                backgroundColor: value === format ? colors.elevated : colors.surface,
                borderWidth: 1,
                borderColor: value === format ? colors.accent : colors.border,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: '500',
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
          <Text style={styles.muted}>
            {visible.length} {visible.length === 1 ? 'artifact' : 'artifacts'} · Recently updated
          </Text>
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
        </View>
        {errors.map((error) => (
          <Text key={error} style={styles.error}>
            {error}
          </Text>
        ))}
      </View>
      <FlatList
        data={visible}
        keyExtractor={({ profile, artifact }) =>
          JSON.stringify([profile.id, artifact.taskId, artifact.id])
        }
        refreshing={loading}
        onRefresh={() => setReload((value) => value + 1)}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <View style={[styles.empty, { gap: 12 }]}>
              <Icon name="artifactList" size={36} color={colors.muted} />
              <Text style={{ fontSize: 18, fontWeight: '600' }}>
                {filtered ? 'No matching artifacts' : 'Your next idea belongs here'}
              </Text>
              <Text style={[styles.muted, { textAlign: 'center' }]}>
                {sources.length
                  ? filtered
                    ? 'Try another search or clear your filters.'
                    : 'Ask an agent to create a document, a graphic or an interactive tool. You’ll find it here, across all your threads.'
                  : 'Enable Dovo Artifacts in a computer’s settings to start your collection.'}
              </Text>
              {filtered && (
                <Action
                  secondary
                  label="Clear filters"
                  onPress={() => {
                    setQuery('')
                    setFormat('all')
                    setState('all')
                  }}
                />
              )}
            </View>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open artifact ${item.artifact.title}`}
            onPress={() => setSelected(item)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              padding: 16,
              minHeight: 112,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.surface,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <ArtifactFormatIcon format={item.artifact.format} large />
            <View style={{ flex: 1, gap: 6 }}>
              <Text numberOfLines={2} style={{ fontWeight: '600' }}>
                {item.artifact.title}
              </Text>
              <Text numberOfLines={1} style={styles.muted}>
                {item.artifact.threadTitle} · {item.computerName}
              </Text>
              <Text style={styles.muted}>
                {artifactFormatLabels[item.artifact.format]} · v{item.artifact.revision} ·{' '}
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
            <Icon name="next" color={colors.muted} />
          </Pressable>
        )}
      />
      {selected && sources.some((source) => source.profile.id === selected.profile.id) && (
        <RuntimeScope runtimeId={selected.profile.id}>
          <ArtifactBrowser
            key={JSON.stringify([selected.profile.id, selected.artifact.id])}
            taskId={selected.artifact.taskId}
            initialId={selected.artifact.id}
            onClose={() => setSelected(undefined)}
          />
        </RuntimeScope>
      )}
    </View>
  )
}
