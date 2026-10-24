import { turnSettingsLabel, responses, type Task } from '@dovo/protocol'
import { pendingQueue } from './pending-send'
import { ScrollView, View } from 'react-native'
import { Pressable } from 'react-native-gesture-handler'
import { QueueDragTarget, useQueueDrag } from './queue-drag'
import { Text } from '../../ui/content/text'
import { useRuntime } from '../../runtime/connection/provider'
import { useAction } from '../../ui/controls/use-action'
import { Action } from '../../ui/controls/action'
import { IconButton } from '../../ui/controls/icon-button'
import { useTheme } from '../../ui/theme'
import { useTaskConversation } from '../conversation/state/provider'
import { useRef, useState } from 'react'
import { Sheet, type SheetHandle } from '../../ui/layout/sheet'
export function MessageQueue({ task, embedded = false }: { task: Task; embedded?: boolean }) {
  const { colors, styles } = useTheme()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const sheet = useRef<SheetHandle>(null)

  const { connected, callEffect } = useRuntime(),
    { act, busy, error } = useAction()
  const { actions } = useTaskConversation()
  const pendingMessages = actions.pendingMessages
  const queue = pendingQueue(task, pendingMessages)
  const change = (action: string, messageId?: string, beforeMessageId?: string | null) =>
    act(() =>
      callEffect(
        '/api/tasks/queue',
        {
          id: task.id,
          action,
          runId: action === 'steer' ? task.activeRunId : undefined,
          messageId,
          beforeMessageId,
        },
        responses.ok,
      ),
    )
  const confirmed = queue.filter(
    (message) => !pendingMessages.some((item) => item.message.id === message.id),
  )
  const canDrag = connected && !busy && !task.archived && confirmed.length > 1
  const drag = useQueueDrag({
    ids: confirmed.map((message) => message.id),
    enabled: canDrag,
    move: (id, before) => change('move', id, before),
  })
  const selectedIndex = queue.findIndex((message) => message.id === selectedId)
  const selected = queue[selectedIndex]
  const selectedPending = pendingMessages.find((item) => item.message.id === selectedId)
  const dismiss = (action: () => void) => sheet.current?.dismiss(action)
  if (!queue.length) return null
  return (
    <View
      testID="Queued messages"
      accessibilityLabel={`${queue.length} queued messages, ${task.queuePaused || queue[0]?.paused ? 'paused' : 'after this turn'}`}
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
      <ScrollView
        ref={drag.scroll}
        removeClippedSubviews={false}
        scrollEnabled={!drag.drag}
        onLayout={({ nativeEvent: { layout } }) => {
          drag.viewport.current.height = layout.height
        }}
        onContentSizeChange={(_width, height) => {
          drag.viewport.current.contentHeight = height
        }}
        onScroll={({ nativeEvent: { contentOffset } }) => {
          drag.viewport.current.offset = contentOffset.y
        }}
        scrollEventThrottle={16}
        style={{ maxHeight: 180 }}
        accessibilityLabel="Queued message list"
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
      >
        {queue.map((message, index) => {
          const pendingMessage = pendingMessages.find((item) => item.message.id === message.id)
          const paused = message.paused || task.queuePaused
          const preview =
            message.text || message.attachments?.map((file) => file.name).join(', ') || ''
          return (
            <View
              key={message.id}
              testID={`Queued message row ${index + 1}`}
              onLayout={({ nativeEvent: { layout } }) => {
                drag.rows.current.set(message.id, layout)
              }}
              style={{
                minHeight: 44,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: colors.border,
                ...(drag.drag?.id === message.id
                  ? {
                      transform: [{ translateY: drag.drag.translation }],
                      zIndex: 2,
                      backgroundColor: colors.surface,
                      opacity: 0.85,
                    }
                  : {}),
              }}
            >
              <Text
                accessibilityLabel={
                  pendingMessage
                    ? pendingMessage.state === 'failed'
                      ? 'Could not send · Retry from composer'
                      : 'Waiting for confirmation'
                    : `Message ${index + 1}${paused ? ', paused' : ''}`
                }
                style={[styles.muted, { minWidth: 20, textAlign: 'center', fontSize: 12 }]}
              >
                {pendingMessage ? (pendingMessage.state === 'failed' ? '!' : '…') : index + 1}
              </Text>
              {drag.drag?.drop?.messageId === message.id && (
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    height: 2,
                    ...(drag.drag.drop.edge === 'before' ? { top: 0 } : { bottom: 0 }),
                    backgroundColor: colors.accent,
                  }}
                />
              )}
              <QueueDragTarget
                enabled={canDrag && !pendingMessage}
                begin={() => drag.begin(message.id)}
                update={drag.update}
                end={drag.end}
                cancel={drag.cancel}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityHint={
                    canDrag && !pendingMessage ? 'Touch and hold to reorder' : undefined
                  }
                  accessibilityActions={
                    canDrag && !pendingMessage
                      ? [
                          { name: 'increment', label: 'Move message later' },
                          { name: 'decrement', label: 'Move message earlier' },
                        ]
                      : undefined
                  }
                  onAccessibilityAction={({ nativeEvent: { actionName } }) => {
                    const source = confirmed.findIndex((item) => item.id === message.id)
                    if (!canDrag || source < 0 || pendingMessage) return
                    if (actionName === 'decrement' && source > 0)
                      change('move', message.id, confirmed[source - 1].id)
                    if (actionName === 'increment' && source < confirmed.length - 1)
                      change('move', message.id, confirmed[source + 2]?.id ?? null)
                  }}
                  accessibilityLabel={`View queued message ${index + 1}: ${preview}`}
                  onPress={() => setSelectedId(message.id)}
                  style={{ flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center' }}
                >
                  <Text
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    style={[styles.text, { fontSize: 14 }]}
                  >
                    {preview.replace(/\s+/g, ' ')}
                    {!!message.text &&
                      !!message.attachments?.length &&
                      ` · ${message.attachments.length} files`}
                    {message.turnSettings && ` · ${turnSettingsLabel(message.turnSettings)}`}
                  </Text>
                </Pressable>
              </QueueDragTarget>
              <IconButton
                icon={paused ? 'play' : 'pause'}
                label={`${paused ? 'Resume' : 'Pause'} queued message ${index + 1}`}
                color={paused ? colors.accent : colors.muted}
                disabled={
                  !connected || busy || task.archived || !!pendingMessage || !!message.steering
                }
                onPress={() => change(paused ? 'resume-message' : 'pause-message', message.id)}
              />
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
                  !!pendingMessage
                }
                onPress={() => actions.beginEdit(message)}
              />
              <IconButton
                icon="more"
                label={`Actions for queued message ${index + 1}`}
                onPress={() => setSelectedId(message.id)}
              />
            </View>
          )
        })}
      </ScrollView>
      {selected && (
        <Sheet
          ref={sheet}
          title={`Queued message ${selectedIndex + 1}`}
          onClose={() => setSelectedId(null)}
        >
          <Text selectable style={styles.text}>
            {selected.text || selected.attachments?.map((file) => file.name).join(', ')}
          </Text>
          {!!selected.text && !!selected.attachments?.length && (
            <Text style={styles.muted}>
              {selected.attachments.map((file) => file.name).join(', ')}
            </Text>
          )}
          {selected.turnSettings && (
            <Text style={styles.muted}>{turnSettingsLabel(selected.turnSettings)}</Text>
          )}
          {selectedPending && (
            <Text accessibilityRole="status" style={styles.muted}>
              {selectedPending.state === 'failed'
                ? 'Could not send · Retry from composer'
                : 'Waiting for confirmation'}
            </Text>
          )}
          <Action
            secondary
            label={`Steer with message ${selectedIndex + 1}`}
            disabled={
              !connected ||
              busy ||
              !!selectedPending ||
              task.status !== 'running' ||
              !!selected.turnSettings
            }
            onPress={() => dismiss(() => change('steer', selected.id))}
          />
          <Action
            secondary
            label={`Return message ${selectedIndex + 1} to composer`}
            disabled={
              !connected ||
              busy ||
              !!actions.editing ||
              actions.busy ||
              actions.attaching ||
              actions.dictation.active ||
              !!selectedPending
            }
            onPress={() =>
              dismiss(() => {
                void actions.restoreQueuedMessage(selected)
              })
            }
          />
        </Sheet>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  )
}
