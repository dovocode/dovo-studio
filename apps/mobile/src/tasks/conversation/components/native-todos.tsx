import { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { nativeTodoSummary, type Task } from '@dovo/protocol'
import { Icon } from '../../../ui/controls/icon'
import { Text } from '../../../ui/content/text'
import { useTheme } from '../../../ui/theme'

/** Shared agent checklist from native progress or the regular task tool, latest state only. */
export function NativeTodos({ task, embedded = false }: { task: Task; embedded?: boolean }) {
  const { colors, styles } = useTheme()
  const [open, setOpen] = useState(false)
  const summary = nativeTodoSummary(task)
  if (!summary) return null
  const todos = task.nativeTodos ?? []
  return (
    <View
      style={
        embedded
          ? { padding: 10, gap: 8 }
          : [styles.card, { marginHorizontal: 16, marginBottom: 6, gap: 8 }]
      }
    >
      {!embedded && (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`Checklist, ${summary.completed} of ${summary.total} done${summary.unfinished ? ', unfinished' : ''}`}
          onPress={() => setOpen((value) => !value)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 }}
        >
          <Icon name="checklist" size={15} color={colors.muted} />
          <Text style={[styles.text, { fontWeight: '600', flexShrink: 1 }]}>
            Checklist · {summary.completed} of {summary.total} done
            {summary.unfinished ? ' · Unfinished' : ''}
          </Text>
          {!!summary.active && !open && (
            <Text numberOfLines={1} style={[styles.muted, { flex: 1 }]}>
              {summary.active}
            </Text>
          )}
        </Pressable>
      )}
      {(open || embedded) && (
        <ScrollView
          style={{ maxHeight: 180 }}
          contentContainerStyle={{ gap: 8 }}
          accessibilityLabel="Checklist items"
          nestedScrollEnabled
        >
          {todos.map((todo, index) => (
            <View
              key={todo.id ?? index}
              style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}
            >
              <Icon
                name={
                  todo.status === 'completed'
                    ? 'checkCircle'
                    : todo.status === 'in-progress' && !summary.unfinished
                      ? 'loader'
                      : 'circle'
                }
                size={14}
                color={
                  todo.status === 'completed'
                    ? colors.success
                    : todo.status === 'in-progress'
                      ? colors.accent
                      : colors.muted
                }
              />
              <Text
                style={[
                  styles.text,
                  { flex: 1 },
                  todo.status === 'completed'
                    ? { color: colors.muted, textDecorationLine: 'line-through' }
                    : todo.status === 'in-progress'
                      ? { fontWeight: '600' }
                      : undefined,
                ]}
              >
                {todo.text}
              </Text>
            </View>
          ))}
        </ScrollView>
      )}
      {summary.unfinished && (
        <Text style={styles.muted}>
          Work stopped with {summary.total - summary.completed}{' '}
          {summary.total - summary.completed === 1 ? 'item' : 'items'} left. Continue the thread to
          pick them up.
        </Text>
      )}
    </View>
  )
}
