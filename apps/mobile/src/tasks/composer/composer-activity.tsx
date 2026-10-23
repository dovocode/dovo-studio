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
  const hasQueue = !!queue.length
  const both = hasQueue && !!summary
  const active = hasQueue ? (summary ? selected : 'queue') : 'checklist'
  if (!hasQueue && !summary) return null
  return (
    <View
      accessibilityLabel="Composer activity"
      style={{
        marginHorizontal: 12,
        marginBottom: -16,
        paddingBottom: 16,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        borderWidth: 1,
        borderBottomWidth: 0,
        borderColor: colors.border,
        backgroundColor: colors.surface,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 }}>
        <View
          accessibilityRole={both ? 'tablist' : undefined}
          style={{ flexDirection: 'row', minWidth: 0, flexShrink: 1 }}
        >
          {[
            ...(hasQueue ? [{ value: 'queue', label: `Queue · ${queue.length}` }] : []),
            ...(summary
              ? [
                  {
                    value: 'checklist',
                    label: `Checklist · ${summary.completed}/${summary.total}${summary.unfinished ? ' · Unfinished' : ''}`,
                  },
                ]
              : []),
          ].map(({ value, label }) =>
            both ? (
              <Pressable
                key={value}
                accessibilityRole="tab"
                accessibilityState={{ selected: active === value }}
                onPress={() => {
                  setSelected(value)
                  setCollapsed(false)
                }}
                style={{
                  minHeight: 44,
                  flexShrink: 1,
                  justifyContent: 'center',
                  paddingHorizontal: 10,
                  borderBottomWidth: active === value ? 2 : 0,
                  borderBottomColor: colors.accent,
                }}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.muted,
                    {
                      color: active === value ? colors.text : colors.muted,
                      fontSize: 12,
                      flexShrink: 1,
                    },
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            ) : (
              <Text
                key={value}
                numberOfLines={1}
                style={[styles.muted, { padding: 10, fontSize: 12, flexShrink: 1 }]}
              >
                {label}
              </Text>
            ),
          )}
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
          <Icon name={collapsed ? 'next' : 'down'} size={20} color={colors.text} />
        </Pressable>
      </View>
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
