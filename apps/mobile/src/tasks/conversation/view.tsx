import { formatTime, useCarMode } from '../../runtime/app-preferences'
import { useApplicationState } from '../../runtime/application-state'
import { mutableStruct, mutableArray } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import { useCallback, useEffect, useRef } from 'react'
import {
  FlatList,
  Pressable,
  Share,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'
import { Text } from '../../ui/text'
import { Schema } from 'effect'
import { attachmentSchema, activitySchema } from '@dovo/protocol'
import {
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  type DataMessagePartProps,
  type ToolCallMessagePartProps,
  type ThreadMessage,
} from '@assistant-ui/react-native'
import { usePendingConversationMessage, useTaskConversation } from './provider'
import { Markdown } from '../../ui/markdown'
import { MessageAttachments } from './message-attachments'
import { colors, styles } from '../../ui/theme'
import { Icon } from '../../ui/icon'
import { ToolActivityRow, ReasoningActivity } from './tool-activity-row'
import { TaskActivity } from './activity'
import { TaskApprovals } from '../approvals'
import { Pill } from '../../ui/pill'
import { ConnectionPill } from '../../runtime/connection-status'
import { useRuntime } from '../../runtime/provider'
import { createConversationScroll } from './scroll'
import { ConversationWorkGroup } from './work-group'
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
  if (useCarMode()) return null
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
          {!user && !!text && (
            <Pressable
              testID="Copy message"
              accessibilityRole="button"
              accessibilityLabel="Copy message"
              hitSlop={6}
              // The system share sheet offers Copy without adding a native clipboard module.
              onPress={() => void Share.share({ message: text }).catch(() => undefined)}
              style={({ pressed }) => ({
                width: 36,
                height: 32,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.5 : 1,
              })}
            >
              <Icon name="copy" size={14} color={colors.muted} />
            </Pressable>
          )}
          <Text style={[styles.muted, { fontSize: 13 }]}>{time}</Text>
        </View>
      )}
    </MessagePrimitive.Root>
  )
}
export function Conversation() {
  const { task, legacyEvents, activityError, followRequest } = useTaskConversation()
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
