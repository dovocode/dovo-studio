import { sameTurnSettings, turnSettingsLabel, responses, type Task } from '@dovo/protocol'
import { pendingQueue } from './pending-send'
import { ScrollView, View } from 'react-native'
import { Text } from '../../ui/content/text'
import { useRuntime } from '../../runtime/connection/provider'
import { useAction } from '../../ui/controls/use-action'
import { Action } from '../../ui/controls/action'
import { IconButton } from '../../ui/controls/icon-button'
import { useTheme } from '../../ui/theme'
import { useTaskConversation } from '../conversation/state/provider'
import { mobileWorkflow } from '../../runtime/state/native-effect'
export function MessageQueue({ task, embedded = false }: { task: Task; embedded?: boolean }) {
  const { colors, styles } = useTheme()

  const { connected, callEffect } = useRuntime(),
    { act, busy, error } = useAction()
  const { actions } = useTaskConversation()
  const pendingMessages = actions.pendingMessages
  const pending = pendingMessages.find((item) => item.destination === 'queue')
  const queue = pendingQueue(task, pendingMessages)
  const change = (action: string, messageId?: string) =>
    act(() =>
      callEffect(
        '/api/tasks/queue',
        {
          id: task.id,
          action,
          runId: action === 'steer' ? task.activeRunId : undefined,
          messageId,
        },
        responses.ok,
      ),
    )
  const restore = (message: (typeof queue)[number]) =>
    act(() =>
      mobileWorkflow(function* () {
        if (
          (actions.draft.text.trim() || actions.draftAttachments?.length) &&
          !sameTurnSettings(message.turnSettings, actions.turnSettings)
        )
          throw new Error(
            'Clear the composer before restoring a message with different model settings',
          )
        yield* callEffect(
          '/api/tasks/queue',
          { id: task.id, action: 'restore', messageId: message.id },
          responses.ok,
        )
        actions.draft.update([actions.draft.text, message.text].filter(Boolean).join('\n\n'))
        actions.setTurnSettings(message.turnSettings ?? null)
      }),
    )
  if (!queue.length) return null
  return (
    <View
      testID="Queued messages"
      accessibilityLabel={`${queue.length} queued messages, ${task.queuePaused ? 'paused' : 'after this turn'}`}
      style={
        embedded
          ? { paddingHorizontal: 10 }
          : {
              marginHorizontal: 12,
              marginBottom: -16,
              paddingBottom: 16,
              paddingHorizontal: 10,
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              borderWidth: 1,
              borderBottomWidth: 0,
              borderColor: colors.border,
              backgroundColor: colors.surface,
            }
      }
    >
      <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text
          numberOfLines={1}
          style={[
            styles.muted,
            {
              flex: 1,
              fontSize: 12,
            },
          ]}
        >
          {!embedded && `${queue.length} queued · `}
          {pending?.destination === 'queue'
            ? pending.state === 'failed'
              ? 'Send failed'
              : pending.state === 'saved'
                ? 'Saved for reconnect'
                : 'Sending…'
            : task.queuePaused
              ? 'Paused'
              : 'After this turn'}
        </Text>
        <Action
          secondary
          label={task.queuePaused ? 'Resume queue' : 'Pause queue'}
          disabled={!connected || busy || !task.queue?.length || task.archived}
          onPress={() => change(task.queuePaused ? 'resume' : 'pause')}
        />
      </View>
      <ScrollView
        style={{ maxHeight: 180 }}
        accessibilityLabel="Queued message list"
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
      >
        {queue.map((message, index) => (
          <View
            key={message.id}
            style={[
              styles.listItem,
              {
                paddingVertical: 8,
                gap: 8,
              },
            ]}
          >
            <View
              style={{
                minWidth: 0,
                gap: 4,
              }}
            >
              <Text style={styles.muted}>
                {pendingMessages.some((item) => item.message.id === message.id)
                  ? pendingMessages.find((item) => item.message.id === message.id)?.state ===
                    'failed'
                    ? 'Could not send · Retry from composer'
                    : 'Waiting for confirmation'
                  : `Message ${index + 1}`}
              </Text>
              <Text numberOfLines={2} style={styles.text}>
                {message.text || message.attachments?.map((file) => file.name).join(', ')}
              </Text>
              {message.turnSettings && (
                <Text numberOfLines={1} style={styles.muted}>
                  {turnSettingsLabel(message.turnSettings)}
                </Text>
              )}
              {!!message.text && !!message.attachments?.length && (
                <Text style={styles.muted}>{message.attachments.length} attachments</Text>
              )}
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 4 }}>
              <IconButton
                icon="edit"
                label={`Edit queued message ${index + 1}`}
                disabled={
                  !connected ||
                  busy ||
                  !!actions.editing ||
                  actions.busy ||
                  actions.attaching ||
                  actions.dictation.active ||
                  pendingMessages.some((item) => item.message.id === message.id)
                }
                onPress={() => {
                  actions.beginEdit(message)
                }}
              />
              <IconButton
                icon="next"
                label={`Steer with message ${index + 1}`}
                disabled={
                  !connected ||
                  busy ||
                  pendingMessages.some((item) => item.message.id === message.id) ||
                  task.status !== 'running' ||
                  !!message.turnSettings
                }
                onPress={() => change('steer', message.id)}
              />
              {queue.length > 1 && (
                <IconButton
                  icon="moveUp"
                  label={`Up ${index + 1}`}
                  disabled={
                    !connected ||
                    busy ||
                    pendingMessages.some((item) => item.message.id === message.id) ||
                    index === 0
                  }
                  onPress={() => change('up', message.id)}
                />
              )}
              <IconButton
                icon="trash"
                label={`Cancel ${index + 1} and return to composer`}
                disabled={
                  !connected ||
                  busy ||
                  !!actions.editing ||
                  pendingMessages.some((item) => item.message.id === message.id)
                }
                onPress={() => restore(message)}
              />
            </View>
          </View>
        ))}
      </ScrollView>
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  )
}
