import { formatTurnDuration } from '@dovo/protocol'
import { useMobilePreferences } from '../../../runtime/preferences/app-preferences'
import { useApplicationState } from '../../../runtime/state/application-state'
import { useEffect, type PropsWithChildren } from 'react'
import { Pressable, View } from 'react-native'
import { activitySchema, activitySummary, decodeResult, mutableStruct } from '@dovo/protocol'
import { Schema } from 'effect'
import { useAuiState } from '@assistant-ui/react-native'
import { useConversationTurn } from '../state/provider'
import { Text } from '../../../ui/content/text'
import { useTheme } from '../../../ui/theme'
import { Icon } from '../../../ui/controls/icon'
import { activityOutcome } from '../state/tool-events'
import { artifactReferences } from '@dovo/protocol'
import { ArtifactCard } from '../../../ui/content/artifacts'

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
  const { colors, styles } = useTheme()

  const message = useAuiState((state) => state.message)
  const id = message.id
  const groupEvents = message.content.slice(startIndex, endIndex + 1).flatMap((part) => {
    if (part.type !== 'tool-call') return []
    const parsed = decodeResult(toolSchema, part.artifact)
    return parsed.success ? [parsed.data] : []
  })
  const summary = [activitySummary(groupEvents), activityOutcome(groupEvents)]
    .filter(Boolean)
    .join(' · ')
  const turn = useConversationTurn(id)
  const workStatus =
    turn?.status === 'running' && message.status?.type !== 'running' ? 'interrupted' : turn?.status
  // Settings → General → Tool activity.
  const { toolActivity } = useMobilePreferences()
  const [open, setOpen] = useApplicationState(toolActivity === 'expanded')
  useEffect(() => {
    setOpen(toolActivity === 'expanded')
  }, [toolActivity])
  const now = Date.now()
  const seconds = turn
    ? Math.max(
        0,
        Math.floor(
          ((turn.finishedAt ? Date.parse(turn.finishedAt) : now) - Date.parse(turn.startedAt)) /
            1000,
        ),
      )
    : 0
  const duration = turn?.finishedAt ? formatTurnDuration(seconds * 1000) : undefined
  const count = endIndex - startIndex + 1
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={summary}
        accessibilityHint={`${count} ${count === 1 ? 'tool call' : 'tool calls'}`}
        accessibilityState={{ expanded: open }}
        onPress={() => {
          setOpen((value) => !value)
        }}
        style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }}
      >
        <Icon name="settings" size={14} color={colors.muted} />
        <Text style={[styles.muted, { flex: 1, fontSize: 13, lineHeight: 18 }]}>{summary}</Text>
        <Icon name={open ? 'down' : 'next'} size={10} color={colors.muted} />
      </Pressable>
      {turn && open && workStatus !== 'running' && (
        <Text style={[styles.muted, { paddingLeft: 22, fontSize: 12, paddingBottom: 4 }]}>
          {duration
            ? `${workStatus === 'failed' ? 'Failed after' : workStatus === 'cancelled' ? 'Cancelled after' : 'Worked for'} ${duration}`
            : workStatus === 'failed'
              ? 'Failed'
              : workStatus === 'cancelled'
                ? 'Cancelled'
                : workStatus === 'interrupted'
                  ? 'Interrupted'
                  : 'Completed'}
        </Text>
      )}
      {open && <View style={{ paddingBottom: 6 }}>{children}</View>}
      {!open &&
        groupEvents
          .flatMap((event) => artifactReferences(event.payload))
          .map((reference) => (
            <ArtifactCard key={`${reference.id}:${reference.revision}`} reference={reference} />
          ))}
    </View>
  )
}
