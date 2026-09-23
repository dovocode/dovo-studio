import { useApplicationState } from '../runtime/application-state'
import { mutableStruct, mutableArray } from '@dovo/protocol'
import { decode, decodeResult } from '@dovo/protocol'
import { useCallback, useEffect, useRef, type PropsWithChildren } from 'react'
import {
  FlatList,
  Pressable,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'
import { Text } from '../ui/text'
import { Schema } from 'effect'
import { attachmentSchema, activitySchema, activitySummary } from '@dovo/protocol'
import {
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  type DataMessagePartProps,
  type ToolCallMessagePartProps,
  type ThreadMessage,
} from '@assistant-ui/react-native'
import { useTaskConversation } from './conversation-provider'
import { Markdown } from '../ui/markdown'
import { MessageAttachments } from './message-attachments'
import { colors, styles } from '../ui/theme'
import { Icon } from '../ui/icon'
import { ToolActivityRow, ReasoningActivity } from './tool-activity-row'
import { activityIdentity, activityOutcome, pendingActivity } from './task-tool-events'
import { TaskActivity } from './task-activity'
import { TaskApprovals } from './approvals'
import { IconButton } from '../ui/icon-button'
import { createConversationScroll } from './conversation-scroll'
const checkpointSchema = mutableStruct({
  turnId: Schema.String,
  files: Schema.Number.pipe(Schema.finite()),
  omitted: Schema.Number.pipe(Schema.finite()),
  pending: Schema.Boolean,
  error: Schema.optional(Schema.String),
})
function AttachmentPart({ data }: DataMessagePartProps<unknown>) {
  const { task } = useTaskConversation()
  return (
    <MessageAttachments taskId={task.id} files={decode(mutableArray(attachmentSchema), data)} />
  )
}
function CheckpointPart({ data }: DataMessagePartProps<unknown>) {
  const checkpoint = decode(checkpointSchema, data)
  const { openCheckpoint } = useTaskConversation()
  return (
    <View
      style={{
        gap: 4,
      }}
    >
      {checkpoint.pending ? (
        <Text style={styles.muted}>Snapshot saved</Text>
      ) : (
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
      )}
      {!!checkpoint.omitted && (
        <Text style={styles.muted}>{checkpoint.omitted} files omitted from snapshot</Text>
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
  return <ToolActivityRow event={decode(toolSchema, artifact)} />
}
function ReasoningPart({ data }: DataMessagePartProps<unknown>) {
  return <ReasoningActivity events={decode(mutableArray(toolSchema), data)} />
}
function WorkGroup({
  children,
  startIndex,
  endIndex,
}: PropsWithChildren<{
  startIndex: number
  endIndex: number
}>) {
  const { task, visible } = useTaskConversation()
  const message = useAuiState((state) => state.message)
  const id = message.id
  const groupEvents = message.content.slice(startIndex, endIndex + 1).flatMap((part) => {
    if (part.type !== 'tool-call') return []
    const parsed = decodeResult(toolSchema, part.artifact)
    return parsed.success ? [parsed.data] : []
  })
  const active = [...groupEvents].reverse().find((event) => pendingActivity(event.status))
  const summary = [activitySummary(groupEvents), activityOutcome(groupEvents)]
    .filter(Boolean)
    .join(' · ')
  const turn = task.turns?.find((item) => item.assistantId === id)
  const workStatus =
    turn?.status === 'running' && message.status?.type !== 'running' ? 'interrupted' : turn?.status
  const [open, setOpen] = useApplicationState(false)
  const [now, setNow] = useApplicationState(Date.now())
  useEffect(() => {
    if (!visible || !open || workStatus !== 'running') return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [workStatus, visible, open])
  const seconds = turn
    ? Math.max(
        0,
        Math.floor(
          ((turn.finishedAt ? Date.parse(turn.finishedAt) : now) - Date.parse(turn.startedAt)) /
            1000,
        ),
      )
    : 0
  const duration =
    workStatus === 'running' || turn?.finishedAt
      ? seconds >= 60
        ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
        : `${seconds}s`
      : undefined
  const count = endIndex - startIndex + 1
  if (groupEvents.length === 1 && active)
    return <ToolActivityRow key={activityIdentity(active)} event={active} compact />
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={summary}
        accessibilityHint={`${count} ${count === 1 ? 'tool call' : 'tool calls'}`}
        accessibilityState={{
          expanded: open,
        }}
        onPress={() => {
          setNow(Date.now())
          setOpen(!open)
        }}
        style={{
          minHeight: 44,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Icon name="settings" size={14} color={colors.muted} />
        <Text
          style={[
            styles.muted,
            {
              flex: 1,
              fontSize: 13,
              lineHeight: 18,
            },
          ]}
        >
          {summary}
        </Text>
        <Icon name={open ? 'down' : 'next'} size={10} color={colors.muted} />
      </Pressable>
      {turn && open && (
        <Text
          style={[
            styles.muted,
            {
              paddingLeft: 22,
              fontSize: 12,
              paddingBottom: 4,
            },
          ]}
        >
          {duration
            ? `${workStatus === 'running' ? 'Working' : workStatus === 'failed' ? 'Failed after' : workStatus === 'cancelled' ? 'Cancelled after' : 'Worked for'} ${duration}`
            : workStatus === 'failed'
              ? 'Failed'
              : workStatus === 'cancelled'
                ? 'Cancelled'
                : workStatus === 'interrupted'
                  ? 'Interrupted'
                  : 'Completed'}
        </Text>
      )}
      {!open && active && <ToolActivityRow key={activityIdentity(active)} event={active} compact />}
      {open && (
        <View
          style={{
            paddingBottom: 6,
          }}
        >
          {children}
        </View>
      )}
    </View>
  )
}
function AssistantText({ text }: { text: string }) {
  return <Markdown text={text} variant="chat" />
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
  const user = useAuiState((state) => state.message.role === 'user')
  const createdAt = useAuiState((state) => state.message.createdAt)
  const streaming = useAuiState((state) => state.message.status?.type === 'running')
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
      {createdAt && (user || !streaming) && (
        <Text
          style={[
            styles.muted,
            {
              fontSize: 12,
              paddingHorizontal: user ? 8 : 0,
            },
          ]}
        >
          {createdAt.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Text>
      )}
    </MessagePrimitive.Root>
  )
}
export function Conversation() {
  const { task, legacyEvents, activityError, followRequest } = useTaskConversation()
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
      <ThreadPrimitive.MessagesFlatList
        ref={list}
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
            gap: 12,
            paddingTop: 10,
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
            <TaskActivity task={task} events={legacyEvents} error={activityError} />
            <TaskApprovals taskId={task.id} />
            {!!task.error && <Text style={styles.error}>{task.error}</Text>}
          </View>
        }
      >
        {() => <Message />}
      </ThreadPrimitive.MessagesFlatList>
      {!following && (
        <View
          style={{
            position: 'absolute',
            bottom: 12,
            alignSelf: 'center',
          }}
        >
          <IconButton label="Latest message" icon="down" variant="glass" onPress={latest} />
        </View>
      )}
    </ThreadPrimitive.Root>
  )
}
