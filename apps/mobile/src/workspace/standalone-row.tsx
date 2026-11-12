import { Image, View } from 'react-native'
import { Pressable } from 'react-native-gesture-handler'
import { projectIcon, projectIconColor, projectIconInitials } from '@dovo/protocol'
import { TaskSwipeActions } from '../tasks/list/task-swipe-actions'
import { chooseSnoozeDuration } from '../tasks/detail/use-task-lifecycle'
import { Icon } from '../ui/controls/icon'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'
import { useMobilePreferences } from '../runtime/preferences/app-preferences'
import { useStandaloneActions } from './resource-actions'
import type { WorkspaceItem } from './workspace-items'

export function StandaloneRow({
  item,
  tile = false,
  onOpen,
  onActions,
}: {
  item: Exclude<WorkspaceItem, { kind: 'thread' }>
  tile?: boolean
  onOpen: () => void
  onActions: () => void
}) {
  const { colors } = useTheme()
  const { threadDensity } = useMobilePreferences()
  const actions = useStandaloneActions(item)
  const dense = threadDensity === 'compact'
  const settled = item.section === 'settled'
  const repository = item.kind === 'terminal' ? item.repository : undefined
  const icon =
    item.kind === 'browser'
      ? 'favicon' in item.tab && typeof item.tab.favicon === 'string'
        ? item.tab.favicon
        : undefined
      : projectIcon(repository)
  const host = item.kind === 'browser' ? new URL(item.tab.url).hostname.replace(/^www\./, '') : ''
  const context = item.kind === 'terminal' ? (repository?.name ?? 'Home folder') : host
  const typeIcon = item.kind === 'terminal' ? 'terminal' : 'web'
  const badge = (
    <View style={{ position: 'relative', width: tile ? 34 : 16, height: tile ? 34 : 16 }}>
      <View
        style={{
          flex: 1,
          borderRadius: tile ? 10 : 4,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: repository ? projectIconColor(repository) : colors.surface,
        }}
      >
        {icon ? (
          <Image source={{ uri: icon }} style={{ width: '100%', height: '100%' }} />
        ) : item.kind === 'browser' ? (
          <Text style={{ fontSize: tile ? 13 : 8, fontWeight: '700' }}>
            {host.slice(0, 2).toUpperCase()}
          </Text>
        ) : repository ? (
          <Text style={{ color: '#fff', fontSize: 8, fontWeight: '700' }}>
            {projectIconInitials(repository)}
          </Text>
        ) : (
          <Icon name="terminal" size={tile ? 22 : 14} color={colors.muted} />
        )}
      </View>
    </View>
  )
  const statusColor = item.offline
    ? colors.muted
    : item.section === 'needs-input'
      ? colors.warning
      : item.section === 'working'
        ? colors.accent
        : settled
          ? colors.success
          : colors.muted
  const status = item.offline ? 'Offline' : item.section === 'snoozed' ? 'Snoozed' : item.status
  const content = (
    <View
      style={{
        marginVertical: dense ? 2 : 3,
        borderRadius: 12,
        backgroundColor: tile ? colors.surface : colors.background,
      }}
    >
      <Pressable
        testID={`Workspace ${item.kind} ${item.title}`}
        accessibilityRole="button"
        accessibilityLabel={`${item.kind}: ${item.title}, ${context}, ${status}`}
        accessibilityHint="Open. Long press for item actions."
        onPress={onOpen}
        onLongPress={onActions}
        accessibilityActions={[{ name: 'activate' }, { name: 'longpress', label: 'Item actions' }]}
        onAccessibilityAction={({ nativeEvent }) =>
          nativeEvent.actionName === 'longpress' ? onActions() : onOpen()
        }
        style={({ pressed }) => ({
          padding: tile ? 12 : 10,
          paddingHorizontal: 12,
          gap: dense ? 3 : 4,
          minHeight: settled ? 44 : undefined,
          opacity: pressed ? 0.55 : 1,
          width: tile ? 88 : undefined,
          alignItems: tile ? 'center' : undefined,
          flexDirection: settled ? 'row' : 'column',
        })}
      >
        {tile ? (
          <>
            {badge}
            <Text numberOfLines={1} style={{ marginTop: 8, fontSize: 11 }}>
              {item.title}
            </Text>
          </>
        ) : (
          <>
            <View
              style={{
                flexDirection: 'row',
                gap: 6,
                alignItems: 'center',
                paddingRight: settled ? 0 : 32,
              }}
            >
              {badge}
              {!settled && (
                <Text
                  numberOfLines={1}
                  style={{ color: colors.muted, flex: 1, fontSize: dense ? 11 : 12 }}
                >
                  {context}
                </Text>
              )}
              {!settled && item.pinned && <Icon name="pin" size={12} color={colors.muted} />}
              {!settled && (
                <Text
                  numberOfLines={1}
                  style={{ color: statusColor, fontSize: dense ? 11 : 12, maxWidth: '45%' }}
                >
                  {status}
                </Text>
              )}
            </View>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                flex: settled ? 1 : undefined,
                minWidth: 0,
              }}
            >
              <Icon name={typeIcon} size={14} color={colors.muted} />
              <Text
                numberOfLines={1}
                style={{
                  color: colors.text,
                  fontSize: dense ? 15 : 16,
                  lineHeight: dense ? 18 : 20,
                  fontWeight: '500',
                  flex: 1,
                }}
              >
                {item.title}
              </Text>
            </View>
            {settled ? (
              <Text style={{ color: statusColor, fontSize: 11 }}>{status}</Text>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Icon
                  name={item.kind === 'terminal' ? 'changes' : 'web'}
                  size={12}
                  color={colors.muted}
                />
                <Text
                  numberOfLines={1}
                  style={{ color: colors.muted, fontSize: dense ? 11 : 12, flex: 1 }}
                >
                  {item.kind === 'terminal'
                    ? `${item.terminal.checkoutBranch ?? 'Shell'} · ${item.detail.split(' · ').at(-1)}`
                    : item.detail}
                </Text>
              </View>
            )}
          </>
        )}
      </Pressable>
      {!tile && !settled && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Actions for ${item.title}`}
          onPress={onActions}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: 44,
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="more" size={20} color={colors.muted} />
        </Pressable>
      )}
    </View>
  )
  if (tile) return content
  return (
    <TaskSwipeActions
      enabled={!actions.disabled}
      primary={{
        label: settled ? 'Restore' : 'Settle',
        icon: settled ? 'reopen' : 'check',
        run: () => actions.change('settle'),
      }}
      secondary={
        settled
          ? undefined
          : {
              label: item.section === 'snoozed' ? 'Wake now' : 'Snooze',
              icon: 'snooze',
              run: () =>
                item.section === 'snoozed'
                  ? actions.change('wake')
                  : chooseSnoozeDuration(
                      `Snooze ${item.kind === 'terminal' ? 'terminal' : 'page'}`,
                      (until) => actions.change('wake', until),
                    ),
            }
      }
    >
      {content}
    </TaskSwipeActions>
  )
}
