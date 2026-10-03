import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native'
import {
  artifactLibrarySchema,
  type ArtifactLibraryEntry,
  type RuntimeProfile,
} from '@dovo/protocol'
import { RuntimeScope, useRuntime } from '../runtime/connection/provider'
import { useNavigation } from '../shell/navigation'
import { ArtifactBrowser } from '../ui/content/artifacts'
import { Text } from '../ui/content/text'
import { SearchField } from '../ui/controls/field'
import { Icon } from '../ui/controls/icon'
import { ScreenHeader } from '../ui/layout/screen-header'
import { colors, styles } from '../ui/theme'

type Entry = { profile: RuntimeProfile; artifact: ArtifactLibraryEntry }
export default function ArtifactsScreen() {
  const { overviews, readRuntime } = useRuntime()
  const { focused } = useNavigation()
  const [query, setQuery] = useState('')
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
      entry.profile.name,
      entry.profile.connection.address,
      entry.profile.connection.token,
      entry.connected,
    ]),
  )
  const load = useEffectEvent(() =>
    Promise.allSettled(
      sources.map(async (entry) => {
        if (!entry.connected) throw new Error(`${entry.profile.name}: offline`)
        const result = await readRuntime(
          entry.profile,
          '/api/artifacts/library',
          {},
          artifactLibrarySchema,
        )
        return result.artifacts.map((artifact): Entry => ({ profile: entry.profile, artifact }))
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
  const visible = entries.filter(({ artifact, profile }) =>
    `${artifact.title} ${artifact.threadTitle} ${artifact.format} ${profile.name}`
      .toLowerCase()
      .includes(search),
  )
  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Artifacts"
        buttons={[
          {
            label: 'Refresh artifacts',
            icon: 'refresh',
            disabled: loading,
            onPress: () => setReload((value) => value + 1),
          },
        ]}
      />
      <View style={{ padding: 16, gap: 12 }}>
        <SearchField
          label="Search artifacts"
          placeholder="Search artifacts"
          value={query}
          onChangeText={setQuery}
        />
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
            <Text style={styles.muted}>
              {search ? 'No matching artifacts.' : 'No artifacts yet.'}
            </Text>
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
              minHeight: 64,
              borderRadius: 12,
              backgroundColor: colors.surface,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Icon name="artifact" />
            <View style={{ flex: 1, gap: 4 }}>
              <Text numberOfLines={2}>{item.artifact.title}</Text>
              <Text numberOfLines={1} style={styles.muted}>
                {item.artifact.threadTitle} · {item.profile.name}
              </Text>
              <Text style={styles.muted}>
                {item.artifact.format} · {item.artifact.threadState} · v{item.artifact.revision}
              </Text>
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
