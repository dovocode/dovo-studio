import { View } from 'react-native'
import { Text } from '../ui/text'
import type { AutomationData, Workspace } from '@dovo/protocol'
import { Choice } from '../ui/choice'
import { Field } from '../ui/field'
import { styles } from '../ui/theme'

export function StepFields({
  data,
  workspace,
  disabled,
  onChange,
}: {
  data: AutomationData
  workspace: Pick<Workspace, 'agents' | 'repositories'>
  disabled: boolean
  onChange: (patch: Partial<AutomationData>) => void
}) {
  return (
    <View style={{ gap: 12 }}>
      <Field
        label="Step name"
        value={data.label}
        editable={!disabled}
        onChangeText={(label) => onChange({ label })}
      />
      {data.kind === 'review' ? (
        <Text style={styles.muted}>
          Pause here until you approve this run. Rejecting stops the remaining steps.
        </Text>
      ) : (
        <>
          <Field
            label="Instructions"
            value={data.objective}
            editable={!disabled}
            onChangeText={(objective) => onChange({ objective })}
            placeholder="What should the agent do and verify?"
            multiline
            style={{ minHeight: 96, textAlignVertical: 'top' }}
          />
          <Choice
            label="Project"
            value={data.repositoryId}
            items={workspace.repositories}
            disabled={disabled || !workspace.repositories.length}
            onChange={(repositoryId) => onChange({ repositoryId })}
          />
          <Choice
            label="Agent"
            value={data.agentId}
            items={workspace.agents.map((agent) => ({
              id: agent.id,
              name: `${agent.name} · ${agent.model || agent.provider}`,
            }))}
            disabled={disabled || !workspace.agents.length}
            onChange={(agentId) => onChange({ agentId })}
          />
          {!workspace.agents.length && (
            <Text style={styles.muted}>
              Add a custom agent in Settings → Agents to use it in an automation.
            </Text>
          )}
          {!workspace.repositories.length && (
            <Text style={styles.muted}>Add a project in Tasks → Projects first.</Text>
          )}
          <Choice
            label="Checkout"
            value={data.execution ?? 'main'}
            disabled={disabled}
            items={[
              { id: 'worktree', name: 'New worktree' },
              { id: 'main', name: 'Local checkout' },
            ]}
            onChange={(execution) => {
              if (execution === 'worktree' || execution === 'main') onChange({ execution })
            }}
          />
          <Text style={styles.muted}>
            Each task has its own chat. A new worktree keeps its changes separate.
          </Text>
        </>
      )}
    </View>
  )
}
