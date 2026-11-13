import { useMemo, useState } from 'react'
import { compareBotActivity } from '@dovo/protocol'
import { FlatList, View } from 'react-native'
import { RuntimeScope, useRuntime } from '../runtime/connection/provider'
import { useMobilePreferences } from '../runtime/preferences/app-preferences'
import { useNavigation } from '../shell/navigation'
import { useMoreActions } from '../shell/more-actions'
import { taskListProjection } from '../tasks/list/task-list-projection'
import { TaskListRow } from '../tasks/list/task-list-row'
import { ScreenHeader } from '../ui/layout/screen-header'
import { SearchField } from '../ui/controls/field'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'
import { CreateBot } from './bot-create'
import { BotSettings } from './bot-settings'
import { useAction } from '../ui/controls/use-action'

export default function BotsScreen() {
  const runtime = useRuntime()
  const preferences = useMobilePreferences()
  const { navigate } = useNavigation()
  const more = useMoreActions(navigate)
  const { styles } = useTheme()
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [settings, setSettings] = useState<{ runtimeId: string; taskId: string }>()
  const { act, busy, error } = useAction()
  const projection = useMemo(
    () => taskListProjection(runtime.overviews, Date.now()),
    [runtime.overviews],
  )
  const rows = [...projection.values()]
    .filter(
      ({ row }) =>
        row.task.bot &&
        !row.task.archivedAt &&
        !row.task.delegation &&
        !row.task.replica &&
        `${row.task.title} ${row.task.bot.role} ${row.runtimeName}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    )
    .sort(
      (a, b) => compareBotActivity(a.row.task, b.row.task) || a.row.key.localeCompare(b.row.key),
    )
  const task = settings
    ? runtime.overviews
        .find((owner) => owner.profile.id === settings.runtimeId)
        ?.snapshot?.workspace.tasks.find((task) => task.id === settings.taskId)
    : undefined
  const supported = runtime.overviews.some((owner) => owner.snapshot?.botsSupported)
  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Bots"
        buttons={[
          {
            label: 'New Bot',
            icon: 'add',
            disabled: !runtime.overviews.some(
              (owner) => owner.connected && owner.snapshot?.botsSupported,
            ),
            onPress: () => setCreating(true),
          },
          ...more,
        ]}
      />
      <View style={{ paddingHorizontal: 16, gap: 8 }}>
        <SearchField label="Search Bots" value={query} onChangeText={setQuery} />
        {!supported && (
          <Text style={styles.muted}>
            Connect a computer with a runtime that supports Bots. Update older runtimes to create
            lasting assistants.
          </Text>
        )}
        {!!error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
      </View>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.row.key}
        contentContainerStyle={{ padding: 16, gap: 8 }}
        refreshing={busy}
        onRefresh={() => act(() => runtime.refreshAll())}
        ListEmptyComponent={
          <Text style={styles.muted}>
            {query
              ? 'No matching Bots.'
              : 'No Bots yet. Create an assistant with a lasting role and responsibilities.'}
          </Text>
        }
        renderItem={({ item }) => (
          <TaskListRow
            row={item.row}
            owner={item.owner}
            now={Date.now()}
            density={preferences.threadDensity}
            testID={`Bot thread ${item.row.task.title}`}
            disabled={false}
            showTypeIndicator
            commands={{
              open: () => navigate('tasks', item.row.task.id, item.row.runtimeId),
              details: () =>
                setSettings({ runtimeId: item.row.runtimeId, taskId: item.row.task.id }),
              select: () =>
                setSettings({ runtimeId: item.row.runtimeId, taskId: item.row.task.id }),
            }}
          />
        )}
      />
      {creating && (
        <CreateBot
          onClose={() => setCreating(false)}
          onCreated={(id, runtimeId) => {
            setCreating(false)
            navigate('tasks', id, runtimeId)
          }}
        />
      )}
      {settings && task && (
        <RuntimeScope runtimeId={settings.runtimeId}>
          <BotSettings task={task} onClose={() => setSettings(undefined)} />
        </RuntimeScope>
      )}
    </View>
  )
}
