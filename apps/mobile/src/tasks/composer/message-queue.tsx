import { Effect } from 'effect'
import {
  watchMessage,
  watchMessagePreview,
  messageSourceLabel,
  messageSourceFor,
  randomUUID,
  turnSettingsLabel,
  responses,
  type Task,
} from '@dovo/protocol'
import { WatchMessageCard } from '../conversation/components/watch-message'
import { MessageSource } from '../conversation/components/message-source'
import { pendingQueue } from './pending-send'
import { ScrollView, View } from 'react-native'
import { GestureDetector, Pressable } from 'react-native-gesture-handler'
import { QueueDragTarget, useQueueDrag } from './queue-drag'
import { Text } from '../../ui/content/text'
import { useRuntime } from '../../runtime/connection/provider'
import { useAction } from '../../ui/controls/use-action'
import { QueueMenu } from './queue-menu'
import { Icon } from '../../ui/controls/icon'
import { IconButton } from '../../ui/controls/icon-button'
import { useTheme } from '../../ui/theme'
import { useTaskConversation } from '../conversation/state/provider'
import { useEffect, useRef, useState } from 'react'
import { Sheet } from '../../ui/layout/sheet'
export function MessageQueue({ task, embedded = false }: { task: Task; embedded?: boolean }) {
  const { colors, styles } = useTheme()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { connected, callEffect, snapshot } = useRuntime(),
    { run, busy: requestBusy, error } = useAction()
  const admitted = useRef(false)
  const pendingOrderRef = useRef<string | null>(null)
  const [pendingOrder, setPendingOrder] = useState<string | null>(null)
  const [moveOverlay, setMoveOverlay] = useState<{ order: string; ids: string[] } | null>(null)
  const [duplicateReceipt, setDuplicateReceipt] = useState<{
    taskId: string
    id: string
    order: string
  } | null>(null)
  const [highlightedCopy, setHighlightedCopy] = useState<string | null>(null)
  const head = task.queue?.[0]
  const queuePaused = !!task.queuePaused || !!head?.paused
  const hasSteering = !!task.queue?.some((message) => message.steering)
  const order = JSON.stringify([task.id, task.queue?.map((message) => message.id) ?? []])
  const currentOrder = useRef(order)
  currentOrder.current = order
  const staleProjection = pendingOrder === order
  const busy = requestBusy || staleProjection
  useEffect(() => {
    if (pendingOrder !== null && pendingOrder !== order) {
      if (pendingOrderRef.current === pendingOrder) pendingOrderRef.current = null
      setPendingOrder((current) => (current === pendingOrder ? null : current))
    }
  }, [order, pendingOrder])
  useEffect(() => {
    if (moveOverlay && (moveOverlay.order !== order || hasSteering)) setMoveOverlay(null)
  }, [order, hasSteering, moveOverlay])
  const { actions } = useTaskConversation()
  const pendingMessages = actions.pendingMessages
  const authoritativeQueue = pendingQueue(task, pendingMessages)
  const pendingQueueSend = authoritativeQueue.some((message) =>
    pendingMessages.some((pending) => pending.message.id === message.id),
  )
  // Presentation only: never rebase an in-flight move onto a changed authoritative order.
  const overlayIds = moveOverlay?.order === order && !hasSteering ? moveOverlay.ids : null
  const queue = overlayIds
    ? [...authoritativeQueue].sort((first, second) => {
        const firstIndex = overlayIds.indexOf(first.id)
        const secondIndex = overlayIds.indexOf(second.id)
        return (
          (firstIndex < 0 ? overlayIds.length : firstIndex) -
          (secondIndex < 0 ? overlayIds.length : secondIndex)
        )
      })
    : authoritativeQueue
  const firstPaused = queue.findIndex((message) => message.paused)
  const change = (action: string, messageId?: string, beforeMessageId?: string | null) => {
    if (admitted.current || busy || pendingOrderRef.current === order) return
    const changesOrder = action === 'move' || action === 'duplicate'
    if (action === 'move') {
      const ids = task.queue?.map((message) => message.id) ?? []
      if (
        hasSteering ||
        !messageId ||
        !ids.includes(messageId) ||
        beforeMessageId === undefined ||
        beforeMessageId === messageId ||
        (beforeMessageId !== null && !ids.includes(beforeMessageId))
      )
        return
      const next = ids.filter((id) => id !== messageId)
      next.splice(
        beforeMessageId === null ? next.length : next.indexOf(beforeMessageId),
        0,
        messageId,
      )
      if (next.every((id, index) => id === ids[index])) return
      setMoveOverlay({ order, ids: next })
    }
    if (changesOrder) {
      pendingOrderRef.current = order
      setPendingOrder(order)
    }
    admitted.current = true
    const duplicateMessageId = action === 'duplicate' ? randomUUID() : undefined
    void run(() =>
      callEffect(
        '/api/tasks/queue',
        {
          id: task.id,
          action,
          runId: action === 'steer' ? task.activeRunId : undefined,
          messageId,
          duplicateMessageId,
          beforeMessageId,
          ...(action === 'move' && snapshot?.promptQueueStagingSupported === true
            ? { expectedMessageIds: task.queue?.map((message) => message.id) ?? [] }
            : {}),
        },
        responses.queueAction,
      ).pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            if (
              changesOrder &&
              (result.recovered ||
                !result.queueMessageIds ||
                JSON.stringify([task.id, result.queueMessageIds]) === currentOrder.current)
            ) {
              if (pendingOrderRef.current === order) pendingOrderRef.current = null
              setPendingOrder((current) => (current === order ? null : current))
              setMoveOverlay((current) => (current?.order === order ? null : current))
            }
            // New hosts return the journal's actual copy ID; older foreground hosts use ours.
            const copyId = result.duplicateMessageId ?? duplicateMessageId
            if (action === 'duplicate' && copyId)
              setDuplicateReceipt({ taskId: task.id, id: copyId, order })
          }),
        ),
        Effect.tapError(() =>
          Effect.sync(() => {
            if (changesOrder && pendingOrderRef.current === order) {
              pendingOrderRef.current = null
              setMoveOverlay((current) => (current?.order === order ? null : current))
              setPendingOrder((current) => (current === order ? null : current))
            }
          }),
        ),
      ),
    ).finally(() => {
      admitted.current = false
    })
  }
  const canSteer = (message: (typeof queue)[number]) =>
    connected &&
    !busy &&
    !task.archived &&
    !task.archivedAt &&
    !message.steering &&
    !!task.activeRunId &&
    !actions.editing &&
    task.status === 'running' &&
    !message.turnSettings &&
    !message.plan &&
    !pendingMessages.some((item) => item.message.id === message.id)
  const canEdit = (message: (typeof queue)[number]) =>
    connected &&
    !busy &&
    !task.archived &&
    !task.archivedAt &&
    !message.steering &&
    !actions.editing &&
    !actions.busy &&
    !actions.attaching &&
    !actions.dictation.active &&
    !pendingMessages.some((item) => item.message.id === message.id)
  const confirmed = queue.filter(
    (message) =>
      !message.steering && !pendingMessages.some((item) => item.message.id === message.id),
  )
  const canDrag =
    connected &&
    !busy &&
    !pendingQueueSend &&
    !task.archived &&
    !task.archivedAt &&
    !hasSteering &&
    confirmed.length > 1
  const drag = useQueueDrag({
    ids: confirmed.map((message) => message.id),
    enabled: canDrag,
    move: (id, before) => change('move', id, before),
  })
  useEffect(() => {
    if (
      !duplicateReceipt ||
      duplicateReceipt.taskId !== task.id ||
      !task.queue?.some((message) => message.id === duplicateReceipt.id)
    )
      return
    // A recovered copy may already be in this snapshot before its replay response arrives.
    if (pendingOrderRef.current === duplicateReceipt.order) pendingOrderRef.current = null
    setPendingOrder((current) => (current === duplicateReceipt.order ? null : current))
    setHighlightedCopy(duplicateReceipt.id)
    const row = drag.rows.current.get(duplicateReceipt.id)
    if (row) {
      drag.scroll.current?.scrollTo({ y: Math.max(0, row.y - 8), animated: true })
      setDuplicateReceipt(null)
    }
  }, [task.id, task.queue, duplicateReceipt])
  useEffect(() => {
    if (!highlightedCopy) return
    const timer = setTimeout(() => setHighlightedCopy(null), 3000)
    return () => clearTimeout(timer)
  }, [highlightedCopy])
  const selectedIndex = queue.findIndex((message) => message.id === selectedId)
  const selected = queue[selectedIndex]
  const selectedWatch = selected ? watchMessage(selected) : null
  const selectedSource = selected ? messageSourceFor(selected) : undefined
  if (!queue.length) return null
  return (
    <View
      testID="Queued messages"
      accessibilityLabel={`${queue.length} queued messages, ${queuePaused ? 'paused' : 'after this turn'}`}
      style={
        embedded
          ? { paddingHorizontal: 12 }
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
      <Text
        accessibilityLiveRegion="polite"
        style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}
      >
        {`${queue.length} queued ${queue.length === 1 ? 'message' : 'messages'}${queuePaused ? ', paused' : ''}`}
      </Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          minHeight: 44,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <Text style={styles.muted}>{queuePaused ? 'Paused' : 'Runs after this turn'}</Text>
        <IconButton
          icon={queuePaused ? 'play' : 'pause'}
          variant={queuePaused ? 'filled' : 'plain'}
          label={
            head?.paused ? 'Resume first prompt' : task.queuePaused ? 'Run queue' : 'Pause queue'
          }
          disabled={
            !connected ||
            busy ||
            !!task.archived ||
            !!task.archivedAt ||
            !confirmed.length ||
            pendingQueueSend ||
            !!head?.steering
          }
          onPress={() =>
            head?.paused
              ? change('resume-message', head.id)
              : change(task.queuePaused ? 'resume' : 'pause')
          }
        />
      </View>
      {(busy || pendingQueueSend) && (
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          Waiting for confirmation
        </Text>
      )}
      <GestureDetector gesture={drag.scrollGesture}>
        <ScrollView
          ref={drag.scroll}
          removeClippedSubviews={false}
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
            const reorderIndex = confirmed.findIndex((item) => item.id === message.id)
            const source = messageSourceFor(message)
            const pendingMessage = pendingMessages.find((item) => item.message.id === message.id)
            const paused = message.paused || task.queuePaused
            const blockedBy = firstPaused >= 0 && firstPaused < index ? firstPaused + 1 : undefined
            const state = [
              paused ? 'Paused' : '',
              blockedBy ? `Waiting behind paused message ${blockedBy}` : '',
            ]
              .filter(Boolean)
              .join(' · ')
            const preview =
              watchMessagePreview(message) ||
              message.attachments?.map((file) => file.name).join(', ') ||
              ''
            // Keep a native stacking context before drag styles change; otherwise Fabric
            // reparents the gesture targets and cancels the active native pan.
            return (
              <View
                key={message.id}
                collapsable={false}
                testID={`Queued message row ${index + 1}`}
                accessibilityLabel={
                  highlightedCopy === message.id ? 'Duplicated queued message' : undefined
                }
                onLayout={({ nativeEvent: { layout } }) => {
                  drag.rows.current.set(message.id, layout)
                  if (duplicateReceipt?.taskId === task.id && duplicateReceipt.id === message.id) {
                    drag.scroll.current?.scrollTo({ y: Math.max(0, layout.y - 8), animated: true })
                    setDuplicateReceipt(null)
                  }
                  if (highlightedCopy === message.id)
                    drag.scroll.current?.scrollTo({ y: Math.max(0, layout.y - 8), animated: true })
                }}
                style={{
                  minHeight: 44,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  paddingVertical: 6,
                  borderTopWidth: index === 0 ? 0 : 1,
                  borderTopColor: colors.border,
                  ...(highlightedCopy === message.id ? { backgroundColor: colors.selection } : {}),
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
                <QueueDragTarget
                  handle
                  scrollGesture={drag.scrollGesture}
                  enabled={canDrag && !pendingMessage && !message.steering}
                  begin={() => drag.begin(message.id)}
                  update={drag.update}
                  end={drag.end}
                  cancel={drag.cancel}
                >
                  <View testID={`Drag queued message ${index + 1}`}>
                    <Text
                      accessibilityLabel={
                        pendingMessage
                          ? pendingMessage.state === 'failed'
                            ? 'Could not send · Retry from composer'
                            : 'Waiting for confirmation'
                          : `Message ${index + 1}${state ? `, ${state}` : ''}`
                      }
                      style={[
                        styles.muted,
                        {
                          width: 24,
                          height: 24,
                          lineHeight: 24,
                          borderRadius: 12,
                          overflow: 'hidden',
                          backgroundColor: colors.selection,
                          textAlign: 'center',
                          fontSize: 12,
                        },
                      ]}
                    >
                      {pendingMessage ? (pendingMessage.state === 'failed' ? '!' : '…') : index + 1}
                    </Text>
                  </View>
                </QueueDragTarget>
                <View style={{ width: 12, flexShrink: 0 }}>
                  {(paused || blockedBy) && (
                    <Icon
                      name={paused ? 'pause' : 'history'}
                      size={12}
                      color={paused ? colors.warning : colors.muted}
                    />
                  )}
                </View>
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
                  scrollGesture={drag.scrollGesture}
                  enabled={canDrag && !pendingMessage && !message.steering}
                  begin={() => drag.begin(message.id)}
                  update={drag.update}
                  end={drag.end}
                  cancel={drag.cancel}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityHint={`Queued message ${index + 1} of ${queue.length}, ${message.steering ? 'being delivered' : 'not sent'}.${canDrag && !pendingMessage && !message.steering ? ' Touch and hold to reorder.' : ''}`}
                    accessibilityActions={
                      canDrag && !pendingMessage && !message.steering
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
                    accessibilityLabel={`View queued message ${index + 1}: ${preview}${state ? `; ${state}` : ''}${message.turnSettings ? '; custom turn settings' : ''}${message.plan ? '; plan mode' : ''}`}
                    onPress={() => setSelectedId(message.id)}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      minHeight: 44,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      {source && source.kind !== 'user' && (
                        <Text
                          numberOfLines={1}
                          style={[styles.text, { fontSize: 12, fontWeight: '500' }]}
                        >
                          {messageSourceLabel(source)}
                        </Text>
                      )}
                      <Text
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        style={[styles.text, { fontSize: 14, lineHeight: 20, minWidth: 0 }]}
                      >
                        {preview.replace(/\s+/g, ' ')}
                        {!!message.text &&
                          !!message.attachments?.length &&
                          ` · ${message.attachments.length} files`}
                      </Text>
                    </View>
                    {message.plan && <Icon name="checklist" size={12} color={colors.accent} />}
                    {message.turnSettings && <Icon name="tune" size={12} color={colors.muted} />}
                  </Pressable>
                </QueueDragTarget>

                <QueueMenu
                  label={`Actions for queued message ${index + 1}`}
                  actions={[
                    {
                      title: 'Move earlier',
                      label: `Move queued message ${index + 1} earlier`,
                      icon: 'moveUp',
                      disabled: !canDrag || reorderIndex <= 0,
                      onPress: () => change('move', message.id, confirmed[reorderIndex - 1]?.id),
                    },
                    {
                      title: 'Move later',
                      label: `Move queued message ${index + 1} later`,
                      icon: 'moveDown',
                      disabled:
                        !canDrag || reorderIndex < 0 || reorderIndex >= confirmed.length - 1,
                      onPress: () =>
                        change('move', message.id, confirmed[reorderIndex + 2]?.id ?? null),
                    },
                    {
                      title: paused ? 'Resume' : 'Pause',
                      label: `${paused ? 'Resume' : 'Pause'} queued message ${index + 1}`,
                      icon: paused ? 'play' : 'pause',
                      disabled:
                        !connected ||
                        busy ||
                        task.archived ||
                        !!task.archivedAt ||
                        !!pendingMessage ||
                        !!message.steering,
                      onPress: () =>
                        change(paused ? 'resume-message' : 'pause-message', message.id),
                    },
                    {
                      title: 'Edit',
                      label: `Edit queued message ${index + 1}`,
                      icon: 'edit',
                      disabled: !canEdit(message),
                      onPress: () => actions.beginEdit(message),
                    },
                    {
                      title: 'Duplicate',
                      label: `Duplicate queued message ${index + 1}`,
                      icon: 'copy',
                      disabled:
                        !connected ||
                        busy ||
                        task.archived ||
                        !!task.archivedAt ||
                        !!pendingMessage ||
                        !!message.steering ||
                        queue.length >= 50,
                      onPress: () => change('duplicate', message.id),
                    },
                    {
                      title: 'Steer now',
                      label: `Steer with message ${index + 1}`,
                      icon: 'steer',
                      disabled: !canSteer(message),
                      onPress: () => change('steer', message.id),
                    },
                    {
                      title: 'Remove',
                      label: `Remove queued message ${index + 1}`,
                      icon: 'close',
                      disabled:
                        !connected ||
                        busy ||
                        task.archived ||
                        !!task.archivedAt ||
                        !!pendingMessage ||
                        !!message.steering,
                      onPress: () => change('remove', message.id),
                    },
                    {
                      title: 'Return to composer',
                      label: `Return message ${index + 1} to composer`,
                      icon: 'restore',
                      disabled: !canEdit(message),
                      onPress: () => {
                        void actions.restoreQueuedMessage(message)
                      },
                    },
                  ]}
                />
                <IconButton
                  icon="steer"
                  label={`Steer with queued message ${index + 1}`}
                  disabled={!canSteer(message)}
                  onPress={() => change('steer', message.id)}
                />
              </View>
            )
          })}
        </ScrollView>
      </GestureDetector>
      {selected && (
        <Sheet title={`Queued message ${selectedIndex + 1}`} onClose={() => setSelectedId(null)}>
          {selectedSource && selectedSource.kind !== 'user' && (
            <MessageSource source={selectedSource} taskId={task.id} />
          )}
          {(task.queuePaused ||
            selected.paused ||
            (firstPaused >= 0 && firstPaused < selectedIndex)) && (
            <Text style={styles.muted}>
              {task.queuePaused
                ? 'Queue paused'
                : selected.paused
                  ? 'Paused'
                  : `Waiting behind paused message ${firstPaused + 1}`}
            </Text>
          )}
          {selectedWatch ? (
            <WatchMessageCard update={selectedWatch} taskId={task.id} />
          ) : (
            <Text selectable style={styles.text}>
              {selected.text || selected.attachments?.map((file) => file.name).join(', ')}
            </Text>
          )}
          {!!selected.text && !!selected.attachments?.length && (
            <Text style={styles.muted}>
              {selected.attachments.map((file) => file.name).join(', ')}
            </Text>
          )}
          {selected.turnSettings && (
            <Text style={styles.muted}>{turnSettingsLabel(selected.turnSettings)}</Text>
          )}
          {selected.turnSettings && (
            <Text style={styles.muted}>
              This message uses its own turn settings. Edit it to use thread defaults before
              steering.
            </Text>
          )}
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
