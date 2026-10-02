import { useEffect } from 'react'
import { useMobilePreferences } from '../../../runtime/preferences/app-preferences'
import { useApplicationState } from '../../../runtime/state/application-state'
import { Pressable, View } from 'react-native'
import { activitySummary, toolPresentation, type Task } from '@dovo/protocol'
import { Text } from '../../../ui/content/text'
import { Icon } from '../../../ui/controls/icon'
import { colors, styles } from '../../../ui/theme'
import {
  activityIdentity,
  activityOutcome,
  taskToolEvents,
  type ToolEvents,
} from '../state/tool-events'
import { ToolActivityRow, ReasoningActivity } from './tool-activity-row'
export function TaskActivity({
  task,
  events,
  error,
}: {
  task: Task
  events: ToolEvents
  error: string
}) {
  const { toolActivity } = useMobilePreferences()
  const [open, setOpen] = useApplicationState(toolActivity === 'expanded')
  useEffect(() => {
    setOpen(toolActivity === 'expanded')
  }, [toolActivity])
  const activity = taskToolEvents(task, events).reverse()
  const reasoning: typeof activity = []
  const tools: typeof activity = []
  for (const event of activity) {
    const isReasoning =
      event.kind === 'reasoning' ||
      toolPresentation(event.payload, event.summary, event.inputPayload).kind === 'reasoning'
    if (isReasoning) reasoning.push(event)
    else tools.push(event)
  }
  if (!activity.length && !error) return null
  return (
    <View
      style={{
        gap: 2,
        paddingVertical: 4,
      }}
    >
      <ReasoningActivity events={reasoning} />
      {tools.length > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{
            expanded: open,
          }}
          style={({ pressed }) => ({
            minHeight: 44,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            opacity: pressed ? 0.65 : 1,
          })}
          onPress={() => setOpen((value) => !value)}
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
            {[activitySummary(tools), activityOutcome(tools)].filter(Boolean).join(' · ')}
          </Text>
          <Icon name={open ? 'down' : 'next'} size={10} color={colors.muted} />
        </Pressable>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {open &&
        tools.map((event) => <ToolActivityRow key={activityIdentity(event)} event={event} />)}
      {!open &&
        tools
          .flatMap((event) => artifactReferences(event.payload))
          .map((reference) => (
            <ArtifactCard key={`${reference.id}:${reference.revision}`} reference={reference} />
          ))}
    </View>
  )
}
import { artifactReferences } from '@dovo/protocol'
import { ArtifactCard } from '../../../ui/content/artifacts'
