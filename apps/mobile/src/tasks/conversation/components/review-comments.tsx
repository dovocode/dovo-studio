import { Pressable, View } from 'react-native'
import { randomUUID } from 'expo-crypto'
import { pendingReviewComments, responses, reviewCommentsPrompt, type Task } from '@dovo/protocol'
import { useApplicationState } from '../../../runtime/state/application-state'
import { useRuntime } from '../../../runtime/connection/provider'
import { useAction } from '../../../ui/controls/use-action'
import { Action } from '../../../ui/controls/action'
import { Sheet } from '../../../ui/layout/sheet'
import { Icon } from '../../../ui/controls/icon'
import { Text } from '../../../ui/content/text'
import { useTheme } from '../../../ui/theme'

/** Review comments left on the computer that the agent has not received yet. */
export function ReviewComments({ task }: { task: Task }) {
  const { colors, styles } = useTheme()

  const { connected, callEffect } = useRuntime()
  const { act, busy, error } = useAction()
  const [open, setOpen] = useApplicationState(false)
  const pending = pendingReviewComments(task)
  if (!pending.length) return null
  const send = () =>
    act(() =>
      callEffect(
        '/api/tasks/message',
        { id: task.id, messageId: randomUUID(), text: reviewCommentsPrompt(pending.length) },
        responses.ok,
      ),
    )
  const label = `${pending.length} review ${pending.length === 1 ? 'comment' : 'comments'} ready`
  return (
    <View style={{ paddingHorizontal: 16 }}>
      <Pressable
        testID="Review comments"
        accessibilityRole="button"
        accessibilityLabel={`${label}. Opens the list to send or remove them.`}
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          minHeight: 44,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          opacity: pressed ? 0.55 : 1,
        })}
      >
        <Icon name="chat" size={15} color={colors.muted} />
        <Text style={[styles.muted, { flex: 1 }]}>{label}</Text>
        <Icon name="next" size={12} color={colors.muted} />
      </Pressable>
      {open && (
        <Sheet title="Review comments" onClose={() => setOpen(false)} busy={busy}>
          <Text style={styles.muted}>
            These reach the agent with your next message, or send them now.
          </Text>
          <Action label="Send to agent" disabled={!connected || busy} onPress={send} />
          {pending.map((comment) => (
            <View key={comment.id} style={[styles.card, { gap: 6 }]}>
              <Text style={[styles.muted, { fontSize: 12 }]}>
                {comment.file ?? 'File'}
                {comment.diffComment ? `:${comment.diffComment.start}` : ''}
              </Text>
              <Text style={styles.text}>{comment.diffComment?.body ?? comment.text}</Text>
              <Action
                secondary
                label="Remove"
                disabled={!connected || busy}
                onPress={() =>
                  act(() =>
                    callEffect(
                      '/api/tasks/feedback/remove',
                      { id: task.id, messageId: comment.id },
                      responses.ok,
                    ),
                  )
                }
              />
            </View>
          ))}
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
