import { useApplicationState } from '../runtime/application-state'
import { Pressable, View } from 'react-native'
import { Text } from '../ui/text'
import { responses, type Task } from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { useAction } from '../ui/use-action'
import { Action } from '../ui/action'
import { Sheet } from '../ui/sheet'
import { Icon } from '../ui/icon'
import { IconButton } from '../ui/icon-button'
import { colors, styles } from '../ui/theme'
import { useTaskConversation } from './conversation-provider'
export function MessageQueue({ task }: { task: Task }) {
  const { connected, callEffect } = useRuntime(),
    { act, busy, error } = useAction()
  const { actions } = useTaskConversation()
  const [open, setOpen] = useApplicationState(false)
  const queue = task.queue ?? []
  const change = (action: string, messageId?: string) =>
    act(() =>
      callEffect(
        '/api/tasks/queue',
        {
          id: task.id,
          action,
          messageId,
        },
        responses.ok,
      ),
    )
  if (!queue.length && !open) return null
  return (
    <View
      style={{
        paddingHorizontal: 16,
      }}
    >
      {!!queue.length && (
        <Pressable
          testID="Queued messages"
          accessibilityRole="button"
          accessibilityLabel={`${queue.length} queued messages, ${task.queuePaused ? 'paused' : 'after this turn'}`}
          onPress={() => {
            if (actions.dictation.active) actions.dictation.stop()
            setOpen(true)
          }}
          style={({ pressed }) => ({
            minHeight: 44,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            opacity: pressed ? 0.55 : 1,
          })}
        >
          <Icon name="jobs" size={15} color={colors.muted} />
          <Text
            style={[
              styles.muted,
              {
                flex: 1,
              },
            ]}
          >
            {queue.length} queued · {task.queuePaused ? 'Paused' : 'After this turn'}
          </Text>
          <Icon name="next" size={12} color={colors.muted} />
        </Pressable>
      )}
      {open && (
        <Sheet title="Queued messages" onClose={() => setOpen(false)} busy={busy}>
          {!!queue.length && (
            <Action
              secondary
              label={task.queuePaused ? 'Resume queue' : 'Pause queue'}
              disabled={!connected || busy || task.archived}
              onPress={() => change(task.queuePaused ? 'resume' : 'pause')}
            />
          )}
          {queue.map((message, index) => (
            <View
              key={message.id}
              style={[
                styles.listItem,
                {
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                },
              ]}
            >
              <View
                style={{
                  flex: 1,
                  minWidth: 0,
                  gap: 4,
                }}
              >
                <Text style={styles.muted}>Message {index + 1}</Text>
                <Text style={styles.text}>
                  {message.text || message.attachments?.map((file) => file.name).join(', ')}
                </Text>
                {!!message.text && !!message.attachments?.length && (
                  <Text style={styles.muted}>{message.attachments.length} attachments</Text>
                )}
              </View>
              <IconButton
                icon="moveUp"
                label={`Up ${index + 1}`}
                disabled={!connected || busy || index === 0}
                onPress={() => change('up', message.id)}
              />
              <IconButton
                icon="trash"
                label={`Remove ${index + 1}`}
                disabled={!connected || busy}
                onPress={() => change('remove', message.id)}
              />
            </View>
          ))}
          {!queue.length && <Text style={styles.muted}>The queue is empty.</Text>}
          {!!error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
        </Sheet>
      )}
    </View>
  )
}
