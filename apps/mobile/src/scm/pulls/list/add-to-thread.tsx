import { useApplicationState } from '../../../runtime/state/application-state'
import { useRuntime } from '../../../runtime/connection/provider'
import { responses, type PullSummary } from '@dovo/protocol'
import { Sheet } from '../../../ui/layout/sheet'
import { SearchField } from '../../../ui/controls/field'
import { Action } from '../../../ui/controls/action'
import { Text } from '../../../ui/content/text'
import { colors } from '../../../ui/theme'
import { FlatList, Pressable, View } from 'react-native'

export function AddPullsToThread({
  pulls,
  onClose,
}: {
  pulls: PullSummary[]
  onClose: () => void
}) {
  const { overviews, readRuntime, refreshRuntime } = useRuntime()
  const [search, setSearch] = useApplicationState('')
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const threads = overviews
    .flatMap((runtime) =>
      (runtime.snapshot?.workspace.tasks ?? [])
        .filter((task) => !task.example && !task.archivedAt)
        .map((task) => ({
          task,
          runtime,
          project:
            runtime.snapshot?.workspace.repositories.find((repo) => repo.id === task.repositoryId)
              ?.name ?? 'No project',
        })),
    )
    .filter(({ task, runtime, project }) =>
      `${task.title} ${project} ${runtime.profile.name}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
  const add = async (thread: (typeof threads)[number]) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await readRuntime(
        thread.runtime.profile,
        '/api/scm/pulls/link-thread',
        {
          id: thread.task.id,
          pulls: pulls.map((pull) => ({
            number: pull.number,
            url: pull.url,
            title: pull.title,
            provider: pull.provider ?? 'github',
            repositoryUrl: pull.url.replace(
              /\/(?:-\/)?(?:pull|pulls|pull-requests|pullrequest|merge_requests)\/\d+\/?(?:[?#].*)?$/i,
              '',
            ),
          })),
        },
        responses.ok,
      )
      await refreshRuntime(thread.runtime.profile)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet
      title={`Add ${pulls.length === 1 ? 'PR' : `${pulls.length} PRs`} to thread`}
      busy={busy}
      scrollable={false}
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <View style={{ flex: 1, gap: 12 }}>
        <Text style={{ color: colors.muted }}>Choose any thread. Its checkout stays the same.</Text>
        <SearchField
          label="Search threads to link"
          placeholder="Search threads, projects or computers…"
          value={search}
          onChangeText={setSearch}
        />
        <FlatList
          data={threads}
          keyExtractor={(thread) => JSON.stringify([thread.runtime.profile.id, thread.task.id])}
          style={{ maxHeight: 420 }}
          renderItem={({ item: thread }) => (
            <Pressable
              accessibilityRole="button"
              disabled={busy || !thread.runtime.connected}
              onPress={() => void add(thread)}
              style={{
                paddingVertical: 12,
                gap: 4,
                opacity: busy || !thread.runtime.connected ? 0.5 : 1,
              }}
            >
              <Text numberOfLines={2}>{thread.task.title}</Text>
              <Text style={{ color: colors.muted }}>
                {thread.project} · {thread.runtime.profile.name}
                {thread.runtime.connected ? '' : ' · Offline'}
              </Text>
            </Pressable>
          )}
          ListEmptyComponent={<Text>No matching threads.</Text>}
        />
        {!!error && <Text style={{ color: colors.error }}>{error}</Text>}
        <Action label="Cancel" secondary disabled={busy} onPress={onClose} />
      </View>
    </Sheet>
  )
}
