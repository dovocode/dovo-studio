import { pendingQueue, visibleMobileSend } from './pending-send'
import { useApplicationState } from '../../runtime/state/application-state'
import { Pressable, View } from 'react-native'
import { Text } from '../../ui/content/text'
import { responses, type Task } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { useAction } from '../../ui/controls/use-action'
import { Action } from '../../ui/controls/action'
import { Sheet } from '../../ui/layout/sheet'
import { Icon } from '../../ui/controls/icon'
import { IconButton } from '../../ui/controls/icon-button'
import { colors, styles } from '../../ui/theme'
import { useTaskConversation } from '../conversation/state/provider'
import { mobileWorkflow } from '../../runtime/state/native-effect'
export function MessageQueue({ task }: { task: Task }) {
  const { connected, callEffect } = useRuntime(),
    { act, busy, error } = useAction()
  const { actions } = useTaskConversation()
  const [open, setOpen] = useApplicationState(false)
  const pending = visibleMobileSend(task, actions.pendingMessage)
  const queue = pendingQueue(task, actions.pendingMessage)
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
  const restore = (message: (typeof queue)[number]) =>
    act(() =>
      mobileWorkflow(function* () {
        yield* callEffect(
          '/api/tasks/queue',
          { id: task.id, action: 'restore', messageId: message.id },
          responses.ok,
        )
        actions.draft.update([actions.draft.text, message.text].filter(Boolean).join('\n\n'))
        setOpen(false)
      }),
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
            {queue.length} queued ·{' '}
            {pending?.destination === 'queue'
              ? pending.state === 'sending'
                ? 'Sending…'
                : 'Send failed'
              : task.queuePaused
                ? 'Paused'
                : 'After this turn'}
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
              disabled={!connected || busy || !task.queue?.length || task.archived}
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
                <Text style={styles.muted}>
                  {pending?.message.id === message.id
                    ? pending.state === 'sending'
                      ? 'Sending…'
                      : 'Could not send · Retry from composer'
                    : `Message ${index + 1}`}
                </Text>
                <Text style={styles.text}>
                  {message.text || message.attachments?.map((file) => file.name).join(', ')}
                </Text>
                {!!message.text && !!message.attachments?.length && (
                  <Text style={styles.muted}>{message.attachments.length} attachments</Text>
                )}
              </View>
              <IconButton
                icon="next"
                label={`Steer with message ${index + 1}`}
                disabled={
                  !connected ||
                  busy ||
                  pending?.message.id === message.id ||
                  task.status !== 'running'
                }
                onPress={() => change('steer', message.id)}
              />
              <IconButton
                icon="moveUp"
                label={`Up ${index + 1}`}
                disabled={!connected || busy || pending?.message.id === message.id || index === 0}
                onPress={() => change('up', message.id)}
              />
              <IconButton
                icon="trash"
                label={`Cancel ${index + 1} and return to composer`}
                disabled={!connected || busy || pending?.message.id === message.id}
                onPress={() => restore(message)}
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
