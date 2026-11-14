import { InterfaceText } from '@dovo/studio-core/interface-language'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { selectPermissionPreset, permissionPolicyLabel } from '@dovo/protocol'
import { LinkedCheckoutEditor } from '../tasks/detail/linked-projects'
import { View } from 'react-native'
import { Text } from '../ui/content/text'
import {
  resolveScopedAgents,
  projectDisplayName,
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
import { SettingsChoice as Choice } from '../screens/settings-controls'
import { SettingsField as Field } from '../screens/settings-controls'
import { useTheme } from '../ui/theme'

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
  const uiText = useInterfaceText()

  const { styles } = useTheme()

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
        label={uiText('Step name')}
        value={data.label}
        editable={!disabled}
        onChangeText={(label) => onChange({ label })}
      />
      {data.kind === 'review' ? (
        <Text style={styles.muted}>
          <InterfaceText>
            {'Pause here until you approve this run. Rejecting stops the remaining steps.'}
          </InterfaceText>
        </Text>
      ) : (
        <>
          <Field
            label={uiText('Instructions')}
            value={data.objective}
            editable={!disabled}
            onChangeText={(objective) => onChange({ objective })}
            placeholder={uiText('What should the agent do and verify?')}
            multiline
            style={{ minHeight: 96, textAlignVertical: 'top' }}
          />
          {(snapshot?.botsSupported || data.botId) && (
            <Choice
              label={uiText('Destination')}
              value={data.botId ?? ''}
              disabled={disabled}
              items={[
                { id: '', name: uiText('New thread for each run') },
                ...(snapshot?.workspace.tasks
                  .filter((task) => task.bot && (!task.archivedAt || task.id === data.botId))
                  .map((task) => ({
                    id: task.id,
                    name: `${task.title}${task.archivedAt ? ' · Archived' : task.bot?.state === 'paused' ? ' · Paused' : ''}`,
                  })) ?? []),
                ...(data.botId &&
                !snapshot?.workspace.tasks.some((task) => task.id === data.botId && task.bot)
                  ? [{ id: data.botId, name: uiText('Unavailable Bot') }]
                  : []),
              ]}
              onChange={(botId) => onChange({ botId: botId || undefined })}
            />
          )}
          {data.botId ? (
            <Text style={styles.muted}>
              <InterfaceText>
                {
                  'This step uses an isolated worker with the Bot’s harness and permissions. Its chat stays available. A paused Bot must resume before this step can run.'
                }
              </InterfaceText>
            </Text>
          ) : (
            <>
              <Choice
                label={uiText('Project')}
                value={data.repositoryId}
                items={workspace.repositories.map((repository) => ({
                  id: repository.id,
                  name: projectDisplayName(repository),
                }))}
                disabled={disabled || !workspace.repositories.length}
                onChange={(repositoryId) => onChange({ repositoryId })}
              />
              <Choice
                label={uiText('Harness')}
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
                label={uiText('Permissions')}
                value={permissionPolicyLabel(agent) === 'Custom' ? 'custom' : agent.permission}
                selectedLabel={uiText(permissionPolicyLabel(agent))}
                disabled={disabled}
                items={selectableAccessModes(agent.permission, agent.provider)
                  .filter((mode) => supportsAccess(agent.provider, mode.id))
                  .map((mode) => ({ id: mode.id, name: mode.name }))}
                onChange={(permission) =>
                  changeAgent(
                    selectPermissionPreset(
                      agent,
                      decode(agentSchema.fields.permission, permission),
                    ),
                  )
                }
              />
              {(agent.provider === 'opencode' ||
                (agent.provider === 'acp' && !agent.acpInstallationId)) && (
                <Field
                  label={
                    agent.provider === 'acp'
                      ? uiText('ACP executable')
                      : uiText('OpenCode server URL')
                  }
                  value={agent.endpoint}
                  editable={!disabled}
                  onChangeText={(endpoint) => changeAgent({ ...agent, endpoint })}
                />
              )}
              {!workspace.repositories.length && (
                <Text style={styles.muted}>
                  <InterfaceText>{'Add a project in Threads → Projects first.'}</InterfaceText>
                </Text>
              )}
              <Choice
                label={uiText('Checkout')}
                value={data.execution ?? 'main'}
                disabled={disabled}
                items={[
                  { id: 'worktree', name: uiText('New worktree') },
                  { id: 'main', name: uiText('Local checkout') },
                ]}
                onChange={(execution) => {
                  if (execution === 'worktree' || execution === 'main') onChange({ execution })
                }}
              />
              <LinkedCheckoutEditor
                value={data.linkedCheckouts ?? []}
                disabled={disabled}
                onChange={(linkedCheckouts) => onChange({ linkedCheckouts })}
              />
              <Text style={styles.muted}>
                <InterfaceText>
                  {'Each task has its own chat. A new worktree keeps its changes separate.'}
                </InterfaceText>
              </Text>
            </>
          )}
        </>
      )}
    </View>
  )
}
