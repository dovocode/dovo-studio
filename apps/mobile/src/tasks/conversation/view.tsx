import { formatTurnDuration } from '@dovo/protocol'
import { fileStats } from '../files/stats'
import { CheckpointFiles } from './components/checkpoint-files'
import {
  formatTime,
  useCarMode,
  useMobilePreferences,
} from '../../runtime/preferences/app-preferences'
import { MessageActions } from './components/message-actions'
import { useApplicationState } from '../../runtime/state/application-state'
import { mutableStruct, mutableArray } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import { useCallback, useEffect, useRef, useMemo, memo } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'
import { Text } from '../../ui/content/text'
import { Schema } from 'effect'
import { attachmentSchema, activitySchema, type TaskTurn } from '@dovo/protocol'
import {
  MessageByIndexProvider,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  type DataMessagePartProps,
  type ToolCallMessagePartProps,
  type ThreadMessage,
} from '@assistant-ui/react-native'
import {
  usePendingConversationMessage,
  useConversationSelector,
  useConversationTurn,
} from './state/provider'
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
import { turnPartBoundaries } from './state/turn-parts'
import { ConversationWorkGroup } from './components/work-group'
const checkpointSchema = mutableStruct({
  turnId: Schema.String,
  files: Schema.Number.pipe(Schema.finite()),
  omitted: Schema.Number.pipe(Schema.finite()),
  error: Schema.optional(Schema.String),
})
function AttachmentPart({ data }: DataMessagePartProps<unknown>) {
  const taskId = useConversationSelector((value) => value.task.id)
  return <MessageAttachments taskId={taskId} files={decode(mutableArray(attachmentSchema), data)} />
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
  const openCheckpoint = useConversationSelector((value) => value.openCheckpoint)
  const car = useCarMode()
  const turn = useConversationSelector(
    useCallback(
      (value) => value.task.turns?.find((item) => item.id === checkpoint.turnId),
      [checkpoint.turnId],
    ),
  )
  if (car) return null
  return <CheckpointRow checkpoint={checkpoint} openCheckpoint={openCheckpoint} turn={turn} />
}
function CheckpointRow({
  checkpoint,
  openCheckpoint,
  turn,
}: {
  checkpoint: Schema.Schema.Type<typeof checkpointSchema>
  openCheckpoint: (turnId: string, path?: string) => void
  turn: TaskTurn | undefined
}) {
  const { collapseChangedFiles } = useMobilePreferences()
  const [expanded, setExpanded] = useApplicationState<boolean | null>(null)
  const showFiles = expanded ?? !collapseChangedFiles
  const totals = useMemo(
    () =>
      (turn?.checkpoint?.files ?? []).map(fileStats).reduce(
        (sum, file) => ({
          additions: sum.additions + file.additions,
          deletions: sum.deletions + file.deletions,
        }),
        { additions: 0, deletions: 0 },
      ),
    [turn?.checkpoint?.files],
  )
  return (
    <View
      style={{
        gap: 4,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable
          testID={`Turn changes · ${checkpoint.files} ${checkpoint.files === 1 ? 'file' : 'files'}`}
          accessibilityRole="button"
          accessibilityLabel={`Turn changes · ${checkpoint.files} ${checkpoint.files === 1 ? 'file' : 'files'}`}
          accessibilityState={{ expanded: showFiles }}
          onPress={() => setExpanded(!showFiles)}
          style={({ pressed }) => ({
            flex: 1,
            minHeight: 44,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            opacity: pressed ? 0.55 : 1,
          })}
        >
          <Icon name={showFiles ? 'down' : 'next'} size={15} color={colors.muted} />
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
          {!!turn?.checkpoint?.files.some((file) => !file.preview) && (
            <>
              <Text style={{ color: '#34d399', fontSize: 12 }}>+{totals.additions}</Text>
              <Text style={{ color: '#fb7185', fontSize: 12 }}>-{totals.deletions}</Text>
            </>
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open turn diff"
          onPress={() => openCheckpoint(checkpoint.turnId)}
          style={{ minHeight: 36, justifyContent: 'center' }}
        >
          <Text style={styles.muted}>Open diff</Text>
        </Pressable>
      </View>
      {showFiles && (
        <CheckpointFiles
          files={turn?.checkpoint?.files ?? []}
          omitted={turn?.checkpoint?.omitted ?? []}
          onOpen={(path) => openCheckpoint(checkpoint.turnId, path)}
        />
      )}

      {!!checkpoint.error && <Text style={styles.error}>{checkpoint.error}</Text>}
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
function WorkingIndicator({ turn }: { turn: TaskTurn }) {
  const [now, setNow] = useApplicationState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const seconds = Math.max(0, Math.floor((now - Date.parse(turn.startedAt)) / 1000))
  const duration = formatTurnDuration(seconds * 1000, true)
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
      <ActivityIndicator size="small" color={colors.muted} />
      <Text accessibilityRole="text" style={[styles.muted, { fontSize: 13 }]}>
        Working for {duration}
      </Text>
    </View>
  )
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
function AssistantParts({ footer = false }: { footer?: boolean }) {
  const message = useAuiState((state) => state.message)
  const turn = useConversationTurn(message.id)
  const turnId = turn?.id ?? message.id
  const collapsed = useConversationSelector(
    useCallback((value) => value.collapsedTurns[turnId], [turnId]),
  )
  const toggleTurn = useConversationSelector((value) => value.toggleTurn)
  const open = !(collapsed ?? turn?.status === 'completed')
  const car = useCarMode()
  const { finalIndex, end } = turnPartBoundaries(message.content, turn?.status === 'running')
  if (footer)
    return (
      <>
        {message.content.slice(end).map((_, index) => (
          <MessagePrimitive.PartByIndex key={end + index} index={end + index} components={parts} />
        ))}
      </>
    )
  if (!turn || car)
    return (
      <>
        {message.content.slice(0, end).map((_, index) => (
          <MessagePrimitive.PartByIndex key={index} index={index} components={parts} />
        ))}
      </>
    )
  const renderRange = (start: number, end: number) => {
    const elements = []
    for (let index = start; index < end; index++) {
      const part = message.content[index]
      if (part.type === 'tool-call') {
        const first = index
        while (index + 1 < end && message.content[index + 1].type === 'tool-call') index++
        elements.push(
          <WorkGroup key={part.toolCallId} startIndex={first} endIndex={index}>
            {Array.from({ length: index - first + 1 }, (_, offset) => (
              <MessagePrimitive.PartByIndex
                key={first + offset}
                index={first + offset}
                components={parts}
              />
            ))}
          </WorkGroup>,
        )
      } else
        elements.push(<MessagePrimitive.PartByIndex key={index} index={index} components={parts} />)
    }
    return elements
  }
  const seconds = Math.max(
    0,
    Math.round((Date.parse(turn.finishedAt ?? turn.startedAt) - Date.parse(turn.startedAt)) / 1000),
  )
  const duration = formatTurnDuration(seconds * 1000)
  const label =
    turn.status === 'running'
      ? 'Turn in progress'
      : turn.status === 'completed'
        ? `Worked for ${duration}`
        : turn.status === 'failed'
          ? 'Turn failed'
          : 'Turn stopped'
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        onPress={() => toggleTurn(turn.id)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 }}
      >
        <Icon name={open ? 'down' : 'next'} size={14} color={colors.muted} />
        <Text style={[styles.muted, { fontSize: 13 }]}>{label}</Text>
      </Pressable>
      {open && renderRange(0, finalIndex >= 0 ? finalIndex : end)}
      {finalIndex >= 0 && renderRange(finalIndex, end)}
    </>
  )
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
  const [showActions, setShowActions] = useApplicationState(false)
  const time = createdAt && formatTime(createdAt, { hour: '2-digit', minute: '2-digit' })
  return (
    <MessagePrimitive.Root
      style={{
        gap: 4,
        alignItems: user ? 'flex-end' : 'stretch',
      }}
    >
      <Pressable
        onPress={() => setShowActions((value) => !value)}
        accessibilityHint="Tap to show message actions and time"
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
        {user ? <MessagePrimitive.Parts components={userParts} /> : <AssistantParts />}
      </Pressable>
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
      {showActions && !car && (user || !streaming) && (
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
      {!user && <AssistantParts footer />}
    </MessagePrimitive.Root>
  )
}
const ConversationMessageCell = memo(function ConversationMessageCell({
  index,
}: {
  index: number
}) {
  return (
    <MessageByIndexProvider index={index}>
      <Message />
    </MessageByIndexProvider>
  )
})
const renderConversationMessage = ({
  item,
}: {
  item: { message: ThreadMessage; index: number }
}) => <ConversationMessageCell index={item.index} />
const messageKey = (item: { message: ThreadMessage; index: number }) => item.message.id
export function Conversation() {
  const history = useConversationSelector((value) => value.history)
  const task = useConversationSelector((value) => value.task)
  const legacyEvents = useConversationSelector((value) => value.legacyEvents)
  const activityError = useConversationSelector((value) => value.activityError)
  const followRequest = useConversationSelector((value) => value.followRequest)
  const lastTurn = task.turns?.at(-1)
  const bookmarks = task.messages.flatMap((message, index) =>
    message.role === 'assistant' && message.bookmarked ? [{ message, index }] : [],
  )
  const car = useCarMode()
  const { activeId, connected } = useRuntime()
  const messages = useAuiState((state) => state.thread.messages)
  const messageCount = messages.length
  const newestFirst = useMemo(
    () => messages.map((message, index) => ({ message, index })).reverse(),
    [messages],
  )
  const list = useRef<FlatList<{ message: ThreadMessage; index: number }>>(null)
  const [scroll] = useApplicationState(() => createConversationScroll({ inverted: true }))
  const [following, setFollowing] = useApplicationState(true)
  const frame = useRef<number | null>(null)
  const pendingOffset = useRef<number | undefined>(undefined)
  const cancelMove = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    pendingOffset.current = undefined
  }, [])
  useEffect(() => cancelMove, [cancelMove])
  const move = useCallback((offset: number | undefined) => {
    if (offset === undefined) return
    pendingOffset.current = offset
    // Streaming and Markdown measurements can arrive together. Apply only the latest extent per frame.
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      if (pendingOffset.current !== undefined)
        list.current?.scrollToOffset({ offset: pendingOffset.current, animated: false })
      pendingOffset.current = undefined
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
              onPress={() => {
                cancelMove()
                scroll.pause()
                setFollowing(false)
                list.current?.scrollToIndex({
                  index: messageCount - 1 - index,
                  animated: true,
                  viewPosition: 0.3,
                })
              }}
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
      <FlatList
        key={task.id}
        data={newestFirst}
        inverted
        renderItem={renderConversationMessage}
        keyExtractor={messageKey}
        maintainVisibleContentPosition={following ? undefined : { minIndexForVisible: 0 }}
        initialNumToRender={8}
        maxToRenderPerBatch={6}
        windowSize={7}
        ref={list}
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          if (scroll.following) {
            latest()
            return
          }
          list.current?.scrollToOffset({ offset: index * averageItemLength, animated: false })
          setTimeout(
            () => list.current?.scrollToIndex({ index, animated: true, viewPosition: 0.3 }),
            100,
          )
        }}
        testID="Conversation messages"
        // Offset zero is the latest reply, independent of older Markdown measurements.
        onContentSizeChange={(_width, height) => move(scroll.content(height))}
        onLayout={({ nativeEvent }) => move(scroll.viewport(nativeEvent.layout.height))}
        onScrollBeginDrag={() => {
          cancelMove()
          scroll.beginInteraction()
        }}
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
            gap: 10,
            paddingTop: !connected || !following ? 44 : 8,
            paddingHorizontal: 20,
            // Reserve overlay space only when a status pill is actually shown.
            paddingBottom: 12,
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
          <View style={{ padding: 12 }}>
            {history.hasMore && (
              <Pressable
                accessibilityRole="button"
                disabled={history.busy || !connected}
                onPress={() => void history.load()}
              >
                <Text style={{ color: colors.accent, textAlign: 'center' }}>
                  {history.busy ? 'Loading earlier messages…' : 'Load earlier messages'}
                </Text>
              </Pressable>
            )}
            {!!history.error && <Text style={styles.error}>{history.error}</Text>}
          </View>
        }
        ListHeaderComponent={
          <View
            style={{
              gap: 10,
            }}
          >
            {!car && <TaskActivity task={task} events={legacyEvents} error={activityError} />}
            {lastTurn?.status === 'running' && <WorkingIndicator turn={lastTurn} />}
            <TaskApprovals taskId={task.id} />
            {!!task.error && <Text style={styles.error}>{task.error}</Text>}
          </View>
        }
      />
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
