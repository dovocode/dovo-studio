import { View } from 'react-native'
import { Text } from '../ui/content/text'
import {
  resolveScopedAgents,
  defaultTaskHarness,
  resolveTaskAgent,
  decode,
  taskHarnessSchema,
  agentSchema,
  selectableAccessModes,
  supportsAccess,
  type Task,
  type Agent,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { ModelSettings } from '../agents/model-settings'
import {
  taskHarnessChoices,
  taskHarnessSelection,
  selectedTaskHarness,
} from '../tasks/creation/harness-choices'
import type { AutomationData, Workspace } from '@dovo/protocol'
import { Choice } from '../ui/controls/choice'
import { Field } from '../ui/controls/field'
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
  const { snapshot } = useRuntime()
  const agents = resolveScopedAgents(
    snapshot?.defaults,
    workspace.repositories.find((repo) => repo.id === data.repositoryId),
    workspace.agents,
  )
  const task: Task = {
    id: 'automation-step',
    title: data.label,
    status: 'draft',
    createdAt: '',
    draft: '',
    messages: [],
    files: [],
    example: false,
    repositoryId: data.repositoryId,
    agentId: data.agentId,
    harness: data.harness,
    agentOverrides: data.agentOverrides,
  }
  const agent = resolveTaskAgent(task, agents) ?? {
    ...defaultTaskHarness('codex'),
    id: task.id,
    name: 'Codex',
  }
  const installations = snapshot?.acpInstallations ?? []
  const changeAgent = (next: Agent) =>
    onChange({ agentId: '', agentOverrides: undefined, harness: decode(taskHarnessSchema, next) })
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
            label="Harness"
            value={taskHarnessSelection(task)}
            items={taskHarnessChoices(
              task,
              agents,
              installations,
              snapshot?.defaults?.modelPreferences,
            )}
            disabled={disabled}
            onChange={(selection) => {
              const next = selectedTaskHarness(task, agents, selection, installations)
              if (!next) return
              if (selection.startsWith('agent:'))
                onChange({
                  agentId: selection.slice(6),
                  harness: decode(taskHarnessSchema, next),
                  agentOverrides: undefined,
                })
              else changeAgent(next)
            }}
          />
          <ModelSettings agent={agent} onChange={changeAgent} disabled={disabled} />
          <Choice
            label="Permissions"
            value={agent.permission}
            disabled={disabled}
            items={selectableAccessModes(agent.permission)
              .filter((mode) => supportsAccess(agent.provider, mode.id))
              .map((mode) => ({ id: mode.id, name: mode.name }))}
            onChange={(permission) =>
              changeAgent({
                ...agent,
                permission: decode(agentSchema.fields.permission, permission),
              })
            }
          />
          {(agent.provider === 'opencode' ||
            (agent.provider === 'acp' && !agent.acpInstallationId)) && (
            <Field
              label={agent.provider === 'acp' ? 'ACP executable' : 'OpenCode server URL'}
              value={agent.endpoint}
              editable={!disabled}
              onChangeText={(endpoint) => changeAgent({ ...agent, endpoint })}
            />
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
