import { sameTurnSettings, turnSettingsLabel } from '@dovo/protocol'
import { pendingQueue } from './pending-send'
import { useApplicationState } from '../../runtime/state/application-state'
import { Pressable, View } from 'react-native'
import { Text } from '../../ui/content/text'
import { responses, type Task } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { useAction } from '../../ui/controls/use-action'
import { Action } from '../../ui/controls/action'
import { Sheet, type SheetHandle } from '../../ui/layout/sheet'
import { useRef } from 'react'
import { Icon } from '../../ui/controls/icon'
import { IconButton } from '../../ui/controls/icon-button'
import { useTheme } from '../../ui/theme'
import { useTaskConversation } from '../conversation/state/provider'
import { mobileWorkflow } from '../../runtime/state/native-effect'
export function MessageQueue({
  task,
  embedded = false,
  hidden = false,
  onOpenChange,
}: {
  task: Task
  embedded?: boolean
  hidden?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const { colors, styles } = useTheme()

  const { connected, callEffect } = useRuntime(),
    { act, busy, error } = useAction()
  const { actions } = useTaskConversation()
  const sheet = useRef<SheetHandle>(null)
  const [open, setOpen] = useApplicationState(false)
  const changeOpen = (value: boolean) => {
    setOpen(value)
    onOpenChange?.(value)
  }
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
        changeOpen(false)
      }),
    )
  if (!queue.length && !open) return null
  return (
    <View
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
      {!!queue.length && (
        <Pressable
          testID="Queued messages"
          accessibilityRole="button"
          accessibilityLabel={`${queue.length} queued messages, ${task.queuePaused ? 'paused' : 'after this turn'}`}
          onPress={() => {
            if (actions.dictation.active) actions.dictation.stop()
            changeOpen(true)
          }}
          style={({ pressed }) => ({
            minHeight: 44,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingVertical: 4,
            opacity: pressed ? 0.55 : 1,
          })}
        >
          <Icon name="jobs" size={15} color={colors.muted} />
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
            {queue.length} queued ·{' '}
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
          <Icon name="next" size={12} color={colors.muted} />
        </Pressable>
      )}
      {open && !hidden && (
        <Sheet ref={sheet} title="Queued messages" onClose={() => changeOpen(false)} busy={busy}>
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
                  {pendingMessages.some((item) => item.message.id === message.id)
                    ? pendingMessages.find((item) => item.message.id === message.id)?.state ===
                      'failed'
                      ? 'Could not send · Retry from composer'
                      : 'Waiting for confirmation'
                    : `Message ${index + 1}`}
                </Text>
                <Text style={styles.text}>
                  {message.text || message.attachments?.map((file) => file.name).join(', ')}
                </Text>
                {message.turnSettings && (
                  <Text style={styles.muted}>{turnSettingsLabel(message.turnSettings)}</Text>
                )}
                {!!message.text && !!message.attachments?.length && (
                  <Text style={styles.muted}>{message.attachments.length} attachments</Text>
                )}
              </View>
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
                  sheet.current?.dismiss(() => actions.beginEdit(message))
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
