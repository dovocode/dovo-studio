import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { nativeTodoSummary, type Task } from '@dovo/protocol'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
import { useTaskConversation } from '../conversation/state/provider'
import { NativeTodos } from '../conversation/components/native-todos'
import { MessageQueue } from './message-queue'
import { pendingQueue } from './pending-send'

export function ComposerActivity({ task }: { task: Task }) {
  const { colors, styles } = useTheme()
  const { actions } = useTaskConversation()
  const [selected, setSelected] = useState('queue')
  const [queueOpen, setQueueOpen] = useState(false)
  const summary = nativeTodoSummary(task)
  const queue = pendingQueue(task, actions.pendingMessages)
  const hasQueue = !!queue.length || queueOpen
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
      <View
        accessibilityRole={both ? 'tablist' : undefined}
        style={{ flexDirection: 'row', paddingHorizontal: 8 }}
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
              onPress={() => setSelected(value)}
              style={{
                minHeight: 44,
                justifyContent: 'center',
                paddingHorizontal: 10,
                borderBottomWidth: active === value ? 2 : 0,
                borderBottomColor: colors.accent,
              }}
            >
              <Text
                style={[
                  styles.muted,
                  { color: active === value ? colors.text : colors.muted, fontSize: 12 },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          ) : (
            <Text key={value} style={[styles.muted, { padding: 10, fontSize: 12 }]}>
              {label}
            </Text>
          ),
        )}
      </View>
      {hasQueue && (
        <View style={{ display: active === 'queue' ? 'flex' : 'none' }}>
          <MessageQueue task={task} embedded onOpenChange={setQueueOpen} />
        </View>
      )}
      {summary && (
        <View style={{ display: active === 'checklist' ? 'flex' : 'none' }}>
          <NativeTodos task={task} embedded />
        </View>
      )}
    </View>
  )
}
