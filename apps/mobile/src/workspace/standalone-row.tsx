import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { Image, View } from 'react-native'
import { Pressable } from 'react-native-gesture-handler'
import { projectIcon, projectIconColor, projectIconInitials } from '@dovo/protocol'
import { TaskSwipeActions } from '../tasks/list/task-swipe-actions'
import { chooseSnoozeDuration } from '../tasks/detail/use-task-lifecycle'
import { Icon } from '../ui/controls/icon'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'
import { useMobilePreferences } from '../runtime/preferences/app-preferences'
import { browserTabSite } from '../browser/browser-state'
import { WorkspaceTypeBadge } from './type-badge'
import { useStandaloneActions } from './resource-actions'
import type { WorkspaceItem } from './workspace-items'

export function StandaloneRow({
  item,
  tile = false,
  workspaceType = false,
  onOpen,
  onActions,
}: {
  item: Exclude<WorkspaceItem, { kind: 'thread' }>
  tile?: boolean
  workspaceType?: boolean
  onOpen: () => void
  onActions: () => void
}) {
  const uiText = useInterfaceText()

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
  const site = item.kind === 'browser' ? browserTabSite(item.tab) : ''
  const context = item.kind === 'terminal' ? (repository?.name ?? 'Home folder') : site
  const detail =
    item.kind === 'terminal'
      ? [context, item.terminal.checkoutBranch].filter(Boolean).join(' · ')
      : [
          site,
          item.linkedProject ||
            (item.tab.profileId === 'device' || item.tab.profileId === 'default'
              ? ''
              : item.tab.profileId),
        ]
          .filter(Boolean)
          .join(' · ')
  const badge = (
    <View style={{ position: 'relative', width: tile ? 34 : 24, height: tile ? 34 : 24 }}>
      <View
        style={{
          flex: 1,
          borderRadius: tile ? 10 : 7,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: repository ? projectIconColor(repository) : colors.surface,
        }}
      >
        {icon ? (
          <Image source={{ uri: icon }} style={{ width: '100%', height: '100%' }} />
        ) : item.kind === 'browser' ? (
          <Text style={{ fontSize: tile ? 13 : 11, fontWeight: '700' }}>
            {site.slice(0, 2).toUpperCase()}
          </Text>
        ) : repository ? (
          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>
            {projectIconInitials(repository)}
          </Text>
        ) : (
          <Icon name="terminal" size={tile ? 22 : 14} color={colors.muted} />
        )}
      </View>
      {workspaceType && <WorkspaceTypeBadge kind={item.kind} />}
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
        accessibilityLabel={`${item.kind}: ${item.title}, ${item.detail}, ${status}`}
        accessibilityHint={uiText('Open. Long press for item actions.')}
        onPress={onOpen}
        onLongPress={onActions}
        accessibilityActions={[
          { name: 'activate' },
          { name: 'longpress', label: uiText('Item actions') },
        ]}
        onAccessibilityAction={({ nativeEvent }) =>
          nativeEvent.actionName === 'longpress' ? onActions() : onOpen()
        }
        style={({ pressed }) => ({
          padding: tile ? 12 : dense ? 6 : 8,
          paddingHorizontal: 12,
          gap: dense ? 3 : 4,
          minHeight: 44,
          opacity: pressed ? 0.55 : 1,
          width: tile ? 88 : undefined,
          alignItems: 'center',
          flexDirection: tile ? 'column' : 'row',
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
            {badge}
            <View style={{ flex: 1, minWidth: 0, gap: 2, paddingRight: settled ? 0 : 32 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text
                  numberOfLines={1}
                  style={{
                    color: colors.text,
                    fontSize: dense ? 15 : 16,
                    fontWeight: '500',
                    flex: 1,
                  }}
                >
                  {item.title}
                </Text>
                {(item.kind === 'terminal' ||
                  item.offline ||
                  settled ||
                  item.section === 'snoozed') && (
                  <Text
                    numberOfLines={1}
                    style={{ color: statusColor, fontSize: 11, maxWidth: '45%' }}
                  >
                    {status}
                  </Text>
                )}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Text
                  numberOfLines={1}
                  style={{ color: colors.muted, fontSize: dense ? 11 : 12, flex: 1 }}
                >
                  {detail}
                </Text>
                {item.pinned && <Icon name="pin" size={12} color={colors.muted} />}
                {(item.kind === 'terminal' || item.tab.kind === 'remote') && (
                  <Icon name="device" size={12} color={colors.muted} />
                )}
              </View>
            </View>
          </>
        )}
      </Pressable>
      {!tile && !settled && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={uiText('Actions for {value0}', { value0: item.title })}
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
        label: settled ? uiText('Restore') : uiText('Settle'),
        icon: settled ? 'reopen' : 'check',
        run: () => actions.change('settle'),
      }}
      secondary={
        settled
          ? undefined
          : {
              label: item.section === 'snoozed' ? uiText('Wake now') : uiText('Snooze'),
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
