import { formatTime, useCarMode } from '../../runtime/preferences/app-preferences'
import { MessageActions } from './components/message-actions'
import { useApplicationState } from '../../runtime/state/application-state'
import { mutableStruct, mutableArray } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import { useCallback, useEffect, useRef } from 'react'
import {
  FlatList,
  Pressable,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Alert,
} from 'react-native'
import { Text } from '../../ui/content/text'
import { Schema } from 'effect'
import { attachmentSchema, activitySchema, responses, type TaskTurn } from '@dovo/protocol'
import { useAction } from '../../ui/controls/use-action'
import {
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  type DataMessagePartProps,
  type ToolCallMessagePartProps,
  type ThreadMessage,
} from '@assistant-ui/react-native'
import { usePendingConversationMessage, useTaskConversation } from './state/provider'
import { Markdown } from '../../ui/content/markdown'
import { MessageAttachments } from './components/message-attachments'
import { colors, styles } from '../../ui/theme'
import { Icon } from '../../ui/controls/icon'
import { ToolActivityRow, ReasoningActivity } from './components/tool-activity-row'
import { TaskActivity } from './components/activity'
import { TaskApprovals } from '../detail/approvals'
import { Pill } from '../../ui/controls/pill'
import { ConnectionPill } from '../../runtime/connection/connection-status'
import { useRuntime } from '../../runtime/connection/provider'
import { createConversationScroll } from './state/scroll'
import { ConversationWorkGroup } from './components/work-group'
const checkpointSchema = mutableStruct({
  turnId: Schema.String,
  files: Schema.Number.pipe(Schema.finite()),
  omitted: Schema.Number.pipe(Schema.finite()),
  error: Schema.optional(Schema.String),
})
function AttachmentPart({ data }: DataMessagePartProps<unknown>) {
  const { task } = useTaskConversation()
  return (
    <MessageAttachments taskId={task.id} files={decode(mutableArray(attachmentSchema), data)} />
  )
}
function TurnSummaryPart({ data }: DataMessagePartProps<unknown>) {
  return <Text style={[styles.muted, { fontSize: 12 }]}>{decode(Schema.String, data)}</Text>
}
function CompactionPart({ data }: DataMessagePartProps<unknown>) {
  const item = decode(
    mutableStruct({ at: Schema.String, trigger: Schema.Literal('manual', 'auto') }),
    data,
  )
  return (
    <Text accessibilityRole="text" style={[styles.muted, { fontSize: 12 }]}>
      Context compacted {formatTime(new Date(item.at), { hour: '2-digit', minute: '2-digit' })} ·{' '}
      {item.trigger === 'auto' ? 'Automatic' : 'Manual'}
    </Text>
  )
}
function CheckpointPart({ data }: DataMessagePartProps<unknown>) {
  const checkpoint = decode(checkpointSchema, data)
  const { openCheckpoint, task } = useTaskConversation()
  const car = useCarMode()
  if (car) return null
  const turn = task.turns?.find((item) => item.id === checkpoint.turnId)
  return (
    <CheckpointRow
      checkpoint={checkpoint}
      openCheckpoint={openCheckpoint}
      taskId={task.id}
      taskRunning={task.status === 'running'}
      turn={turn}
    />
  )
}
function CheckpointRow({
  checkpoint,
  openCheckpoint,
  taskId,
  taskRunning,
  turn,
}: {
  checkpoint: Schema.Schema.Type<typeof checkpointSchema>
  openCheckpoint: (turnId: string) => void
  taskId: string
  taskRunning: boolean
  turn: TaskTurn | undefined
}) {
  const { connected, callEffect } = useRuntime()
  const restore = useAction()
  const undone = !!turn?.checkpoint?.undone
  const canRestore =
    !!turn &&
    turn.status !== 'running' &&
    (undone || (!!turn.checkpoint?.after && !turn.checkpoint.error && checkpoint.files > 0))
  const confirmRestore = () =>
    Alert.alert(
      undone ? 'Redo this turn’s changes?' : 'Undo this turn’s changes?',
      undone
        ? 'The files go back to how they were right before you undid this turn. The agent gets a note about it.'
        : 'The files this turn changed go back to how they were before it. Your current files are saved first, so you can redo this. The agent gets a note about it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: undone ? 'Redo changes' : 'Undo changes',
          style: undone ? 'default' : 'destructive',
          onPress: () =>
            restore.act(() =>
              callEffect(
                '/api/tasks/turn/restore',
                { id: taskId, turnId: checkpoint.turnId, direction: undone ? 'redo' : 'undo' },
                responses.ok,
              ),
            ),
        },
      ],
    )
  return (
    <View
      style={{
        gap: 4,
      }}
    >
      <Pressable
        testID={`Turn changes · ${checkpoint.files} ${checkpoint.files === 1 ? 'file' : 'files'}`}
        accessibilityRole="button"
        accessibilityLabel={`Turn changes · ${checkpoint.files} ${checkpoint.files === 1 ? 'file' : 'files'}`}
        onPress={() => openCheckpoint(checkpoint.turnId)}
        style={({ pressed }) => ({
          minHeight: 44,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          opacity: pressed ? 0.55 : 1,
        })}
      >
        <Icon name="changes" size={15} color={colors.muted} />
        <Text
          style={[
            styles.muted,
            {
              flexShrink: 1,
            },
          ]}
        >
          {checkpoint.files} {checkpoint.files === 1 ? 'file' : 'files'} changed
        </Text>
        <Icon name="next" size={12} color={colors.muted} />
      </Pressable>
      {!!checkpoint.omitted && (
        <Text style={styles.muted}>{checkpoint.omitted} files omitted from snapshot</Text>
      )}
      {!!checkpoint.error && <Text style={styles.error}>{checkpoint.error}</Text>}
      {canRestore && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={undone ? 'Redo this turn’s changes' : 'Undo this turn’s changes'}
          accessibilityHint={taskRunning ? 'Stop the agent first.' : undefined}
          disabled={!connected || taskRunning || restore.busy}
          onPress={confirmRestore}
          style={({ pressed }) => ({
            minHeight: 36,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            opacity: pressed || !connected || taskRunning || restore.busy ? 0.5 : 1,
          })}
        >
          <Icon name="refresh" size={14} color={colors.muted} />
          <Text style={styles.muted}>
            {undone ? 'Changes undone · Redo' : 'Undo these changes'}
          </Text>
        </Pressable>
      )}
      {!!restore.error && <Text style={styles.error}>{restore.error}</Text>}
    </View>
  )
}
const toolSchema = mutableStruct({
  ...activitySchema.fields.events.value.fields,
  ...{
    status: Schema.String,
    turnId: Schema.optional(Schema.String),
    inputPayload: Schema.optional(Schema.String),
  },
})
function ToolPart({ artifact }: ToolCallMessagePartProps<unknown, unknown>) {
  if (useCarMode()) return null
  return <ToolActivityRow event={decode(toolSchema, artifact)} />
}
function ReasoningPart({ data }: DataMessagePartProps<unknown>) {
  if (useCarMode()) return null
  return <ReasoningActivity events={decode(mutableArray(toolSchema), data)} />
}
function AssistantText({ text }: { text: string }) {
  return <Markdown text={text} variant="chat" />
}
/** Car mode hides each turn's commands, edits and searches; only what the agent says stays. */
function WorkGroup(props: Parameters<typeof ConversationWorkGroup>[0]) {
  return useCarMode() ? null : <ConversationWorkGroup {...props} />
}
const parts = {
  Text: AssistantText,
  ToolGroup: WorkGroup,
  tools: {
    Fallback: ToolPart,
  },
  data: {
    by_name: {
      'dovo.attachments': AttachmentPart,
      'dovo.checkpoint': CheckpointPart,
      'dovo.reasoning': ReasoningPart,
      'dovo.compaction': CompactionPart,
      'dovo.turn-summary': TurnSummaryPart,
    },
  },
}
function UserText({ text }: { text: string }) {
  return (
    <Text selectable style={styles.chatText}>
      {text}
    </Text>
  )
}
const userParts = {
  ...parts,
  Text: UserText,
}
function Message() {
  const pendingMessage = usePendingConversationMessage()
  const id = useAuiState((state) => state.message.id)
  const user = useAuiState((state) => state.message.role === 'user')
  const createdAt = useAuiState((state) => state.message.createdAt)
  const streaming = useAuiState((state) => state.message.status?.type === 'running')
  const text = useAuiState((state) =>
    state.message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n\n'),
  )
  const car = useCarMode()
  const time = createdAt && formatTime(createdAt, { hour: '2-digit', minute: '2-digit' })
  return (
    <MessagePrimitive.Root
      style={{
        gap: 4,
        alignItems: user ? 'flex-end' : 'stretch',
      }}
    >
      <View
        style={
          user
            ? {
                alignSelf: 'flex-end',
                maxWidth: '88%',
                paddingHorizontal: 13,
                paddingVertical: 9,
                borderRadius: 18,
                backgroundColor: colors.elevated,
                gap: 4,
              }
            : {
                gap: 5,
              }
        }
      >
        <MessagePrimitive.Parts components={user ? userParts : parts} />
      </View>
      {pendingMessage?.message.id === id && (
        <Text
          accessibilityRole="text"
          style={[styles.muted, { fontSize: 12, paddingHorizontal: 8 }]}
        >
          {pendingMessage.state === 'failed'
            ? 'Not confirmed · retry from the composer'
            : 'Sending…'}
        </Text>
      )}
      {!!time && !car && (user || !streaming) && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 2,
            paddingHorizontal: user ? 8 : 0,
            marginLeft: user ? 0 : -10,
          }}
        >
          {user && <Text style={[styles.muted, { fontSize: 13 }]}>{time}</Text>}
          {!!text && <MessageActions text={text} user={user} messageId={id} />}
          {!user && <Text style={[styles.muted, { fontSize: 13 }]}>{time}</Text>}
        </View>
      )}
    </MessagePrimitive.Root>
  )
}
export function Conversation() {
  const { task, legacyEvents, activityError, followRequest } = useTaskConversation()
  const bookmarks = task.messages.flatMap((message, index) =>
    message.role === 'assistant' && message.bookmarked ? [{ message, index }] : [],
  )
  const car = useCarMode()
  const { activeId } = useRuntime()
  const list = useRef<FlatList<ThreadMessage>>(null)
  const [scroll] = useApplicationState(createConversationScroll)
  const [following, setFollowing] = useApplicationState(true)
  const move = useCallback((offset: number | undefined) => {
    if (offset !== undefined)
      list.current?.scrollToOffset({
        offset,
        animated: false,
      })
  }, [])
  const latest = useCallback(() => {
    move(scroll.latest())
    setFollowing(true)
  }, [move, scroll])
  useEffect(latest, [followRequest, latest])
  const recordScroll = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    scroll.scroll(nativeEvent.contentOffset.y)
    setFollowing(scroll.following)
  }
  const endInteraction = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    scroll.endInteraction(nativeEvent.contentOffset.y)
    setFollowing(scroll.following)
  }
  return (
    <ThreadPrimitive.Root
      style={{
        flex: 1,
      }}
    >
      {!!bookmarks.length && (
        <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingVertical: 5 }}>
          {bookmarks.map(({ message, index }, position) => (
            <Pressable
              key={message.id}
              accessibilityRole="button"
              accessibilityLabel={`Jump to bookmarked reply ${position + 1}`}
              onPress={() =>
                list.current?.scrollToIndex({ index, animated: true, viewPosition: 0.3 })
              }
              style={{
                paddingHorizontal: 8,
                paddingVertical: 5,
                borderRadius: 8,
                backgroundColor: colors.elevated,
              }}
            >
              <Text style={styles.muted}>★ {position + 1}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <ThreadPrimitive.MessagesFlatList
        ref={list}
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          list.current?.scrollToOffset({ offset: index * averageItemLength, animated: false })
          setTimeout(
            () => list.current?.scrollToIndex({ index, animated: true, viewPosition: 0.3 }),
            100,
          )
        }}
        testID="Conversation messages"
        // FlatList.scrollToEnd uses estimated cell frames. Native Markdown may finish
        // measuring later, so follow the actual content extent with one scroll owner.
        autoScroll={false}
        scrollToBottomOnInitialize={false}
        scrollToBottomOnRunStart={false}
        scrollToBottomOnThreadSwitch={false}
        onContentSizeChange={(_width, height) => move(scroll.content(height))}
        onLayout={({ nativeEvent }) => move(scroll.viewport(nativeEvent.layout.height))}
        onScrollBeginDrag={() => scroll.beginInteraction()}
        onMomentumScrollBegin={() => scroll.beginMomentum()}
        onScroll={recordScroll}
        onScrollEndDrag={({ nativeEvent }) => {
          scroll.endDrag(
            nativeEvent.contentOffset.y,
            nativeEvent.velocity?.y,
            nativeEvent.targetContentOffset?.y,
          )
          setFollowing(scroll.following)
        }}
        onMomentumScrollEnd={endInteraction}
        scrollEventThrottle={16}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          {
            gap: 18,
            paddingTop: 12,
            paddingHorizontal: 20,
            // Room for the floating status pills so they never cover the last message.
            paddingBottom: 64,
          },
        ]}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon name="chat" size={24} color={colors.muted} />
            <Text
              style={[
                styles.title,
                {
                  textAlign: 'center',
                  fontSize: 20,
                },
              ]}
            >
              What are we building?
            </Text>
            <Text
              style={[
                styles.muted,
                {
                  textAlign: 'center',
                },
              ]}
            >
              Describe a change or ask a question.
            </Text>
          </View>
        }
        ListFooterComponent={
          <View
            style={{
              gap: 10,
            }}
          >
            {car ? (
              task.status === 'running' && (
                <Text accessibilityRole="text" style={[styles.muted, { fontSize: 17 }]}>
                  Working…
                </Text>
              )
            ) : (
              <TaskActivity task={task} events={legacyEvents} error={activityError} />
            )}
            <TaskApprovals taskId={task.id} />
            {!!task.error && <Text style={styles.error}>{task.error}</Text>}
          </View>
        }
      >
        {() => <Message />}
      </ThreadPrimitive.MessagesFlatList>
      {/* Floating status stack just above the composer. */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          bottom: 4,
          left: 0,
          right: 0,
          alignItems: 'center',
          gap: 8,
        }}
      >
        <ConnectionPill runtimeId={activeId} />
        {!following && (
          <Pill testID="Latest message" icon="down" label="Latest message" onPress={latest} />
        )}
      </View>
    </ThreadPrimitive.Root>
  )
}
