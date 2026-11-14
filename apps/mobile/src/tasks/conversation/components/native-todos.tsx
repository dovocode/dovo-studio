import { InterfaceText } from '@dovo/studio-core/interface-language'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { nativeTodoSummary, type Task } from '@dovo/protocol'
import { Icon } from '../../../ui/controls/icon'
import { Text } from '../../../ui/content/text'
import { useTheme } from '../../../ui/theme'

/** Shared agent checklist from native progress or the regular task tool, latest state only. */
export function NativeTodos({
  task,
  embedded = false,
  onClear,
  clearDisabled = false,
}: {
  task: Task
  embedded?: boolean
  onClear?: (items: NonNullable<Task['nativeTodos']>) => Promise<unknown>
  clearDisabled?: boolean
}) {
  const uiText = useInterfaceText()

  const { colors, styles } = useTheme()
  const [open, setOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState<Task['nativeTodos']>()
  const summary = nativeTodoSummary(task)
  if (!summary) return null
  const todos = task.nativeTodos ?? []
  return (
    <View
      style={
        embedded
          ? { padding: 14, gap: 8 }
          : [styles.card, { marginHorizontal: 16, marginBottom: 6, gap: 8 }]
      }
    >
      {!embedded && (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={uiText('Checklist, {value0} of {value1} done{value2}', {
            value0: summary.completed,
            value1: summary.total,
            value2: summary.unfinished ? uiText(', unfinished') : '',
          })}
          onPress={() => setOpen((value) => !value)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 }}
        >
          <Icon name="checklist" size={15} color={colors.muted} />
          <Text style={[styles.text, { fontWeight: '600', flexShrink: 1 }]}>
            <InterfaceText
              values={{
                value0: summary.completed,
                value1: summary.total,
                value2: summary.unfinished ? uiText(' · Unfinished') : '',
              }}
            >
              {'Checklist · {value0} of {value1} done{value2}'}
            </InterfaceText>
          </Text>
          {!!summary.active && !open && (
            <Text numberOfLines={1} style={[styles.muted, { flex: 1 }]}>
              {summary.active}
            </Text>
          )}
        </Pressable>
      )}
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={uiText('Checklist completion')}
        accessibilityValue={{ min: 0, max: summary.total, now: summary.completed }}
        style={{
          ...(embedded ? { position: 'absolute', width: 1, height: 1, opacity: 0 } : { height: 4 }),
          backgroundColor: colors.selection,
          borderRadius: 2,
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
      {(open || embedded) && (
        <ScrollView
          style={{ maxHeight: 180 }}
          contentContainerStyle={{ gap: 8 }}
          accessibilityLabel={uiText('Checklist items')}
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
                    ? colors.muted
                    : todo.status === 'in-progress'
                      ? colors.accent
                      : colors.muted
                }
              />
              <Text
                accessibilityLabel={`${todo.text}, ${todo.status !== 'completed' && summary.unfinished ? uiText('unfinished') : todo.status.replace('-', ' ')}`}
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
          <InterfaceText
            values={{
              value0: summary.total - summary.completed,
              value1: summary.total - summary.completed === 1 ? uiText('item') : uiText('items'),
            }}
          >
            {'Work stopped with {value0} {value1} left. Continue the thread to pick them up.'}
          </InterfaceText>
        </Text>
      )}
      {onClear && (open || embedded) && (
        <View style={{ gap: 8 }}>
          {confirmation && (
            <Text style={styles.muted}>
              <InterfaceText values={{ value0: confirmation.length }}>
                {'Clear all {value0} checklist items, including unfinished work?'}
              </InterfaceText>
            </Text>
          )}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Pressable
              accessibilityRole="button"
              disabled={clearDisabled || clearing}
              accessibilityState={{ disabled: clearDisabled || clearing, busy: clearing }}
              style={{
                minHeight: 44,
                justifyContent: 'center',
                paddingHorizontal: 8,
                opacity: clearDisabled || clearing ? 0.5 : 1,
              }}
              onPress={async () => {
                setError('')
                if (!confirmation) {
                  setConfirmation(todos)
                  return
                }
                setClearing(true)
                try {
                  await onClear(confirmation)
                } catch (error) {
                  setError(error instanceof Error ? error.message : String(error))
                } finally {
                  setClearing(false)
                  setConfirmation(undefined)
                }
              }}
            >
              <Text style={styles.muted}>
                {clearing
                  ? uiText('Clearing…')
                  : confirmation
                    ? uiText('Confirm clear checklist')
                    : uiText('Clear checklist')}
              </Text>
            </Pressable>
            {confirmation && (
              <Pressable
                accessibilityRole="button"
                disabled={clearing}
                style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }}
                onPress={() => setConfirmation(undefined)}
              >
                <Text style={styles.text}>{uiText('Cancel')}</Text>
              </Pressable>
            )}
          </View>
          {!!error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
        </View>
      )}
    </View>
  )
}
