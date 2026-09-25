import { useApplicationState } from '../../runtime/application-state'
import { Pressable, View } from 'react-native'
import { activitySummary, toolPresentation, type Task } from '@dovo/protocol'
import { Text } from '../../ui/text'
import { Icon } from '../../ui/icon'
import { colors, styles } from '../../ui/theme'
import {
  activityIdentity,
  activityOutcome,
  pendingActivity,
  taskToolEvents,
  type ToolEvents,
} from './tool-events'
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
  const [open, setOpen] = useApplicationState(false)
  const activity = taskToolEvents(task, events).reverse()
  const reasoning = activity.filter(
    (event) =>
      event.kind === 'reasoning' ||
      toolPresentation(event.payload, event.summary, event.inputPayload).kind === 'reasoning',
  )
  const tools = activity.filter((event) => !reasoning.includes(event))
  const active = [...tools].reverse().find((event) => pendingActivity(event.status))
  if (!activity.length && !error) return null
  return (
    <View
      style={{
        gap: 2,
        paddingVertical: 4,
      }}
    >
      <ReasoningActivity events={reasoning} />
      {tools.length > 0 && !(tools.length === 1 && active) && (
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
      {!open && active && <ToolActivityRow key={activityIdentity(active)} event={active} compact />}
      {open &&
        tools.map((event) => <ToolActivityRow key={activityIdentity(event)} event={event} />)}
    </View>
  )
}
