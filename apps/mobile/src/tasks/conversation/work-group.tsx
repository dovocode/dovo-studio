import { useApplicationState } from '../../runtime/application-state'
import { useEffect, type PropsWithChildren } from 'react'
import { Pressable, View } from 'react-native'
import { activitySchema, activitySummary, decodeResult, mutableStruct } from '@dovo/protocol'
import { Schema } from 'effect'
import { useAuiState } from '@assistant-ui/react-native'
import { useTaskConversation } from './provider'
import { Text } from '../../ui/text'
import { colors, styles } from '../../ui/theme'
import { Icon } from '../../ui/icon'
import { ToolActivityRow } from './tool-activity-row'
import { activityIdentity, activityOutcome, pendingActivity } from './tool-events'

const toolSchema = mutableStruct({
  ...activitySchema.fields.events.value.fields,
  status: Schema.String,
  turnId: Schema.optional(Schema.String),
  inputPayload: Schema.optional(Schema.String),
})

export function ConversationWorkGroup({
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
        accessibilityState={{ expanded: open }}
        onPress={() => {
          setNow(Date.now())
          setOpen(!open)
        }}
        style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }}
      >
        <Icon name="settings" size={14} color={colors.muted} />
        <Text style={[styles.muted, { flex: 1, fontSize: 13, lineHeight: 18 }]}>{summary}</Text>
        <Icon name={open ? 'down' : 'next'} size={10} color={colors.muted} />
      </Pressable>
      {turn && open && (
        <Text style={[styles.muted, { paddingLeft: 22, fontSize: 12, paddingBottom: 4 }]}>
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
      {open && <View style={{ paddingBottom: 6 }}>{children}</View>}
    </View>
  )
}
