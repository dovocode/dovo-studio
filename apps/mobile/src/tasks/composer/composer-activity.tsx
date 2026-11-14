import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import { nativeTodoSummary, responses, type Task } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { Icon } from '../../ui/controls/icon'
import { Text } from '../../ui/content/text'
import { Glass } from '../../ui/layout/glass'
import { useTheme } from '../../ui/theme'
import { useTaskConversation } from '../conversation/state/provider'
import { NativeTodos } from '../conversation/components/native-todos'
import { MessageQueue } from './message-queue'
import { pendingQueue } from './pending-send'

export function ComposerActivity({ task, attached = false }: { task: Task; attached?: boolean }) {
  const uiText = useInterfaceText()

  const { colors, styles } = useTheme()
  const { actions } = useTaskConversation()
  const { call, connected } = useRuntime()
  const [selected, setSelected] = useState('queue')
  const [collapsed, setCollapsed] = useState(false)
  const previousInputs = useRef(new Set<string>())
  const { snapshot } = actions
  useEffect(() => {
    const inputs = [
      ...(snapshot?.questions ?? [])
        .filter((item) => item.taskId === task.id)
        .map((item) => item.id),
      ...(snapshot?.approvals ?? [])
        .filter((item) => item.taskId === task.id)
        .map((item) => item.id),
    ]
    if (inputs.some((id) => !previousInputs.current.has(id))) setCollapsed(true)
    previousInputs.current = new Set(inputs)
  }, [task.id, snapshot?.questions, snapshot?.approvals])
  const summary = nativeTodoSummary(task)
  const queue = pendingQueue(task, actions.pendingMessages)
  const pausedCount = task.queuePaused
    ? queue.length
    : queue.filter((message) => message.paused).length
  const hasQueue = !!queue.length
  const both = hasQueue && !!summary
  const active = hasQueue ? (summary ? selected : 'queue') : 'checklist'
  if (!hasQueue && !summary) return null
  const renderHeader = (playback?: ReactNode) => (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 4,
        paddingVertical: 2,
        borderBottomWidth: collapsed ? 0 : 1,
        borderBottomColor: colors.border,
      }}
    >
      <View
        accessibilityRole={both ? 'tablist' : undefined}
        style={{ flexDirection: 'row', minWidth: 0, flexShrink: 1, flex: 1, gap: 2 }}
      >
        {[
          ...(hasQueue
            ? [
                {
                  value: 'queue',
                  title: uiText('Queue'),
                  count: String(queue.length),
                  notice: pausedCount > 0,
                  label: uiText('Queue · {value0}{value1}', {
                    value0: queue.length,
                    value1: pausedCount
                      ? pausedCount === queue.length
                        ? ' · Paused'
                        : ` · ${pausedCount} paused`
                      : '',
                  }),
                },
              ]
            : []),
          ...(summary
            ? [
                {
                  value: 'checklist',
                  title: uiText('Checklist'),
                  count: `${summary.completed}/${summary.total}`,
                  notice: summary.unfinished,
                  label: uiText('Checklist · {value0}/{value1}{value2}', {
                    value0: summary.completed,
                    value1: summary.total,
                    value2: summary.unfinished ? ' · Unfinished' : '',
                  }),
                },
              ]
            : []),
        ].map(({ value, label, title, count, notice }) => {
          const content = (
            <>
              <Text
                numberOfLines={1}
                style={[
                  styles.muted,
                  {
                    fontSize: 12,
                    flexShrink: 1,
                    color: active === value ? colors.text : colors.muted,
                  },
                ]}
              >
                {title}
              </Text>
              <View
                style={{
                  flexShrink: 0,
                  borderRadius: 6,
                  paddingHorizontal: 4,
                  paddingVertical: 2,
                  backgroundColor: colors.selection,
                }}
              >
                <Text
                  style={[
                    styles.muted,
                    {
                      fontSize: 10,
                      fontWeight: '600',
                      fontVariant: ['tabular-nums'],
                      color: notice ? colors.warning : colors.text,
                    },
                  ]}
                >
                  {count}
                </Text>
              </View>
            </>
          )
          return both ? (
            <Pressable
              key={value}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: active === value }}
              onPress={() => {
                setSelected(value)
                setCollapsed(false)
              }}
              style={{
                minHeight: 44,
                flexShrink: 1,
                justifyContent: 'center',
                paddingHorizontal: 3,
                minWidth: 0,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 2,
                borderRadius: 6,
                backgroundColor: active === value ? colors.selection : 'transparent',
              }}
            >
              {content}
            </Pressable>
          ) : (
            <View
              key={value}
              accessible
              accessibilityRole="text"
              accessibilityLabel={label}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                minWidth: 0,
                flexShrink: 1,
                minHeight: 44,
                paddingHorizontal: 4,
              }}
            >
              {content}
            </View>
          )
        })}
      </View>
      {playback}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          collapsed ? uiText('Expand composer activity') : uiText('Collapse composer activity')
        }
        accessibilityState={{ expanded: !collapsed }}
        onPress={() => setCollapsed((value) => !value)}
        style={({ pressed }) => ({
          width: 44,
          minHeight: 44,
          flexShrink: 0,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <View style={{ transform: [{ rotate: collapsed ? '0deg' : '180deg' }] }}>
          <Icon name="down" size={18} color={colors.text} />
        </View>
      </Pressable>
    </View>
  )
  const Surface = attached ? View : Glass
  return (
    <View
      accessibilityLabel={uiText('Composer activity')}
      style={{
        marginHorizontal: attached ? 20 : 12,
        marginTop: 0,
        marginBottom: attached ? -1 : 8,
      }}
    >
      <Surface
        style={{
          borderRadius: attached ? 16 : 12,
          ...(attached ? { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 } : {}),
          backgroundColor: attached ? colors.surface : undefined,
          overflow: 'hidden',
          borderWidth: 1,
          borderBottomWidth: attached ? 0 : 1,
          borderColor: colors.border,
        }}
      >
        {hasQueue ? (
          <MessageQueue
            task={task}
            embedded
            renderHeader={renderHeader}
            visible={!collapsed && active === 'queue'}
          />
        ) : (
          renderHeader()
        )}
        {collapsed && summary && (
          <View
            accessibilityRole="progressbar"
            accessibilityLabel={uiText('Checklist completion')}
            accessibilityValue={{ min: 0, max: summary.total, now: summary.completed }}
            style={{
              marginHorizontal: 10,
              marginBottom: 6,
              height: 4,
              borderRadius: 2,
              backgroundColor: colors.selection,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                height: 4,
                width: `${(summary.completed / summary.total) * 100}%`,
                backgroundColor: colors.success,
              }}
            />
          </View>
        )}
        {summary && (
          <View style={{ display: !collapsed && active === 'checklist' ? 'flex' : 'none' }}>
            <NativeTodos
              key={task.id}
              task={task}
              embedded
              clearDisabled={!connected}
              onClear={(expectedItems) =>
                call('/api/tasks/checklist/clear', { id: task.id, expectedItems }, responses.ok)
              }
            />
          </View>
        )}
      </Surface>
    </View>
  )
}
