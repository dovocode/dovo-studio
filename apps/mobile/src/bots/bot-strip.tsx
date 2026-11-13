import { useMobilePreferences } from '../runtime/preferences/app-preferences'
import { Alert, Pressable, ScrollView, View, type DimensionValue } from 'react-native'
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
  const { botLayout, botsInThreads } = useMobilePreferences()
  const rows = botLayout === 'rows'
  const horizontal = botLayout === 'horizontal'
  const width: DimensionValue = horizontal
    ? 80
    : botLayout === 'grid-2'
      ? '50%'
      : botLayout === 'grid-3'
        ? '33.333333%'
        : '100%'
  if (botsInThreads === false || (!entries.length && !onCreate)) return null
  const tiles = (
    <>
      {[...entries]
        .sort(
          (a, b) =>
            compareBotActivity(a.row.task, b.row.task) || a.row.key.localeCompare(b.row.key),
        )
        .map((entry) => (
          <BotTile key={entry.row.key} entry={entry} onOpen={onOpen} width={width} rows={rows} />
        ))}
      {onCreate && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New Bot"
          accessibilityHint="Choose a computer and create a Bot."
          disabled={createDisabled}
          onPress={onCreate}
          style={({ pressed }) => ({
            width,
            flexDirection: rows ? 'row' : 'column',
            paddingHorizontal: rows ? 8 : 2,
            gap: 9,
            paddingVertical: 6,
            borderRadius: 12,
            alignItems: 'center',
            opacity: createDisabled ? 0.5 : pressed ? 0.7 : 1,
          })}
        >
          <View
            style={{
              width: rows ? 42 : 62,
              height: rows ? 42 : 62,
              borderRadius: rows ? 21 : 31,
              borderStyle: 'dashed',
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.background,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="add" size={22} color={colors.muted} />
          </View>
          {!!entries.length && (
            <Text style={[styles.muted, { fontSize: 12, lineHeight: 16, textAlign: 'center' }]}>
              New Bot
            </Text>
          )}
        </Pressable>
      )}
    </>
  )
  return (
    <View
      testID={`Bot layout ${botLayout}`}
      accessibilityLabel="Bots"
      style={{ gap: 6, paddingTop: 8, paddingBottom: 10 }}
    >
      {horizontal ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 4, paddingVertical: 5, paddingHorizontal: 2 }}
        >
          {tiles}
        </ScrollView>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 4, paddingVertical: 5 }}>
          {tiles}
        </View>
      )}
    </View>
  )
}

function BotTile({
  entry: { row },
  onOpen,
  width,
  rows,
}: {
  entry: TaskListRowData
  width: DimensionValue
  rows: boolean
  onOpen: (id: string, runtimeId: string) => void
}) {
  const { colors, styles } = useTheme()
  const lifecycle = useTaskLifecycle(row.task, row.runtimeId)
  const unread = hasUnreadTaskActivity(row.task)
  return (
    <View style={{ width, paddingHorizontal: 2 }}>
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
        style={({ pressed }) => ({
          gap: 9,
          flexDirection: rows ? 'row' : 'column',
          paddingHorizontal: rows ? 8 : 0,
          paddingVertical: 6,
          borderRadius: 12,
          alignItems: 'center',
          backgroundColor: pressed ? colors.surface : undefined,
        })}
      >
        <View
          style={{
            borderRadius: rows ? 21 : 31,
            borderWidth: 1,
            borderColor: colors.border,
            padding: 2,
          }}
        >
          <BotAvatar
            avatar={row.task.bot?.avatar}
            name={row.task.title}
            round
            size={rows ? 36 : 56}
          />
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
          numberOfLines={1}
          style={[
            styles.text,
            {
              fontSize: 12,
              lineHeight: 16,
              flex: rows ? 1 : undefined,
              minWidth: 0,
              width: rows ? undefined : '100%',
              textAlign: rows ? 'left' : 'center',
              color: unread ? colors.text : colors.muted,
              fontWeight: unread ? '600' : '400',
            },
          ]}
        >
          {row.task.title}
        </Text>
      </Pressable>
      {!!lifecycle.error && <Text accessibilityRole="alert">{lifecycle.error}</Text>}
    </View>
  )
}
