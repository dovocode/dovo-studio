import { useEffect, useRef, useState } from 'react'
import { Pressable, View } from 'react-native'
import { nativeTodoSummary, responses, type Task } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { Icon } from '../../ui/controls/icon'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
import { useTaskConversation } from '../conversation/state/provider'
import { NativeTodos } from '../conversation/components/native-todos'
import { MessageQueue } from './message-queue'
import { pendingQueue } from './pending-send'

export function ComposerActivity({ task }: { task: Task }) {
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
  return (
    <View
      accessibilityLabel="Composer activity"
      style={{
        marginHorizontal: 12,
        marginBottom: 8,
        borderRadius: 16,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderBottomWidth: collapsed ? 0 : 1,
          borderBottomColor: colors.border,
        }}
      >
        <View
          accessibilityRole={both ? 'tablist' : undefined}
          style={{ flexDirection: 'row', minWidth: 0, flexShrink: 1, flex: 1, gap: 4 }}
        >
          {[
            ...(hasQueue
              ? [
                  {
                    value: 'queue',
                    title: 'Queue',
                    count: String(queue.length),
                    notice: pausedCount > 0,
                    label: `Queue · ${queue.length}${pausedCount ? (pausedCount === queue.length ? ' · Paused' : ` · ${pausedCount} paused`) : ''}`,
                  },
                ]
              : []),
            ...(summary
              ? [
                  {
                    value: 'checklist',
                    title: 'Checklist',
                    count: `${summary.completed}/${summary.total}`,
                    notice: summary.unfinished,
                    label: `Checklist · ${summary.completed}/${summary.total}${summary.unfinished ? ' · Unfinished' : ''}`,
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
                      fontSize: 13,
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
                    paddingHorizontal: 5,
                    paddingVertical: 2,
                    backgroundColor: colors.selection,
                  }}
                >
                  <Text
                    style={[
                      styles.muted,
                      {
                        fontSize: 11,
                        fontWeight: '600',
                        fontVariant: ['tabular-nums'],
                        color: colors.text,
                      },
                    ]}
                  >
                    {count}
                  </Text>
                </View>
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={{
                    width: 12,
                    height: 12,
                    flexShrink: 0,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {notice &&
                    (value === 'queue' ? (
                      <View style={{ flexDirection: 'row', gap: 2, flexShrink: 0 }}>
                        {[0, 1].map((bar) => (
                          <View
                            key={bar}
                            style={{
                              width: 2,
                              height: 10,
                              borderRadius: 1,
                              backgroundColor: colors.warning,
                            }}
                          />
                        ))}
                      </View>
                    ) : (
                      <Icon name="error" size={12} color={colors.warning} />
                    ))}
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
                  paddingHorizontal: 8,
                  minWidth: 0,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 5,
                  borderRadius: 8,
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
                  gap: 5,
                  minWidth: 0,
                  flexShrink: 1,
                  minHeight: 44,
                  paddingHorizontal: 8,
                  borderBottomWidth: 2,
                  borderBottomColor: 'transparent',
                }}
              >
                {content}
              </View>
            )
          })}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={collapsed ? 'Expand composer activity' : 'Collapse composer activity'}
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
      {collapsed && summary && (
        <View
          accessibilityRole="progressbar"
          accessibilityLabel="Checklist completion"
          accessibilityValue={{ min: 0, max: summary.total, now: summary.completed }}
          style={{
            marginHorizontal: 10,
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
      {hasQueue && (
        <View style={{ display: !collapsed && active === 'queue' ? 'flex' : 'none' }}>
          <MessageQueue task={task} embedded />
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
    </View>
  )
}
