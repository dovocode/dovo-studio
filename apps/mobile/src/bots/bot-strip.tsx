import { Alert, Pressable, ScrollView, View } from 'react-native'
import { compareBotActivity, hasUnreadTaskActivity } from '@dovo/protocol'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'
import type { TaskListRowData } from '../tasks/list/task-list-projection'
import { BotAvatar } from './bot-avatar'
import { Icon } from '../ui/controls/icon'
import { useTaskLifecycle } from '../tasks/detail/use-task-lifecycle'

export function BotStrip({
  entries,
  onOpen,
  onCreate,
  createDisabled = false,
}: {
  onCreate?: () => void
  createDisabled?: boolean
  entries: readonly TaskListRowData[]
  onOpen: (id: string, runtimeId: string) => void
}) {
  const { colors, styles } = useTheme()
  if (!entries.length && !onCreate) return null
  return (
    <View accessibilityLabel="Bots" style={{ gap: 8, paddingVertical: 12 }}>
      <Text style={[styles.muted, { fontWeight: '600' }]}>Bots</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 12, paddingVertical: 4 }}
      >
        {[...entries]
          .sort(
            (a, b) =>
              compareBotActivity(a.row.task, b.row.task) || a.row.key.localeCompare(b.row.key),
          )
          .map((entry) => (
            <BotTile key={entry.row.key} entry={entry} onOpen={onOpen} />
          ))}
        {onCreate && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New Bot"
            accessibilityHint="Choose a computer and create a Bot."
            disabled={createDisabled}
            onPress={onCreate}
            style={{ width: 76, gap: 6, alignItems: 'center', opacity: createDisabled ? 0.5 : 1 }}
          >
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surface,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="add" size={24} color={colors.accent} />
            </View>
            {!!entries.length && (
              <Text style={[styles.text, { fontSize: 12, textAlign: 'center' }]}>New Bot</Text>
            )}
          </Pressable>
        )}
      </ScrollView>
    </View>
  )
}

function BotTile({
  entry: { row },
  onOpen,
}: {
  entry: TaskListRowData
  onOpen: (id: string, runtimeId: string) => void
}) {
  const { colors, styles } = useTheme()
  const lifecycle = useTaskLifecycle(row.task, row.runtimeId)
  const unread = hasUnreadTaskActivity(row.task)
  return (
    <View style={{ width: 76 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open Bot ${row.task.title} on ${row.runtimeName}${unread ? ', new messages' : ''}${row.task.pinned ? ', pinned' : ''}${row.online ? '' : ', offline'}`}
        accessibilityHint="Touch and hold to pin or unpin this Bot."
        onPress={() => onOpen(row.task.id, row.runtimeId)}
        onLongPress={() =>
          Alert.alert(row.task.title, row.runtimeName, [
            {
              text: row.task.pinned ? 'Unpin Bot' : 'Pin Bot',
              onPress: () => {
                if (row.online && !lifecycle.busy) lifecycle.togglePinned()
              },
            },
            { text: 'Open Bot', onPress: () => onOpen(row.task.id, row.runtimeId) },
            { text: 'Cancel', style: 'cancel' },
          ])
        }
        style={{ gap: 6, alignItems: 'center' }}
      >
        <View>
          <BotAvatar avatar={row.task.bot?.avatar} name={row.task.title} />
          {unread && (
            <View
              testID={`Unread Bot ${row.key}`}
              style={{
                position: 'absolute',
                top: -2,
                right: -2,
                width: 13,
                height: 13,
                borderRadius: 7,
                borderWidth: 2,
                borderColor: colors.background,
                backgroundColor: colors.accent,
              }}
            />
          )}
          {row.task.pinned && (
            <View
              style={{
                position: 'absolute',
                bottom: -2,
                left: -2,
                backgroundColor: colors.background,
                borderRadius: 8,
                padding: 2,
              }}
            >
              <Icon name="pin" size={12} color={colors.muted} />
            </View>
          )}
        </View>
        <Text
          numberOfLines={2}
          style={[
            styles.text,
            { fontSize: 12, textAlign: 'center', fontWeight: unread ? '600' : '400' },
          ]}
        >
          {row.task.title}
        </Text>
      </Pressable>
      {!!lifecycle.error && <Text accessibilityRole="alert">{lifecycle.error}</Text>}
    </View>
  )
}
