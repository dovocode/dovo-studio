import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { taskWorkflows, workflowStateLabel, type TaskMetadata, type Subagent } from '@dovo/protocol'
import { View, Pressable } from 'react-native'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
import { useRuntime } from '../../runtime/connection/provider'
import { useNavigation } from '../../shell/navigation'

export function TaskWorkflows({
  task,
  onOpenThread,
}: {
  task: TaskMetadata
  onOpenThread: (thread: { taskId: string; agent: Subagent }) => void
}) {
  const uiText = useInterfaceText()

  const { snapshot, connected, profile } = useRuntime()
  const { colors, styles } = useTheme()
  const { navigate } = useNavigation()
  const workflows = taskWorkflows(task, snapshot?.workspace.tasks ?? [])
  if (!workflows.length) return null
  return (
    <View accessibilityLabel={uiText('Workflows')} style={{ gap: 12, marginBottom: 16 }}>
      {workflows.map((workflow) => (
        <View
          key={workflow.id}
          accessibilityLabel={uiText('Workflow: {value0}', { value0: workflow.name })}
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            padding: 12,
            gap: 10,
          }}
        >
          <Text style={{ fontWeight: '600' }}>{workflow.name}</Text>
          <Text style={styles.muted}>
            {!connected && workflow.state === 'working'
              ? uiText('Last seen working')
              : workflowStateLabel[workflow.state]}
          </Text>
          {!!workflow.description && <Text style={styles.muted}>{workflow.description}</Text>}
          {workflow.phases.map((phase, index) => (
            <View key={phase.id} style={{ gap: 6 }}>
              <Text style={{ fontWeight: '600', fontSize: 13 }}>
                {index + 1}. {phase.title}
              </Text>
              <Text style={styles.muted}>
                {!connected && phase.state === 'working'
                  ? uiText('Last seen working')
                  : workflowStateLabel[phase.state]}
              </Text>
              {!phase.members.length && (
                <Text style={styles.muted}>
                  <InterfaceText>{'No agents assigned yet.'}</InterfaceText>
                </Text>
              )}
              {phase.members.map((member) => (
                <Pressable
                  key={member.id}
                  accessibilityRole="button"
                  disabled={!member.taskId && !member.agent}
                  onPress={() => {
                    if (member.taskId)
                      navigate(
                        'tasks',
                        member.taskId,
                        member.runtimeId === 'local' ? profile?.id : member.runtimeId,
                      )
                    else if (member.agent) onOpenThread({ taskId: task.id, agent: member.agent })
                  }}
                  style={{ padding: 8, gap: 4 }}
                >
                  <Text style={{ fontWeight: '500' }}>{member.name} ›</Text>
                  <Text style={styles.muted}>
                    {[
                      member.provider,
                      !connected && member.state === 'working'
                        ? 'Last seen working'
                        : workflowStateLabel[member.state],
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  {!!(member.result || member.activity) && (
                    <Text numberOfLines={2} style={styles.muted}>
                      {member.result || member.activity}
                    </Text>
                  )}
                </Pressable>
              ))}
            </View>
          ))}
        </View>
      ))}
    </View>
  )
}
