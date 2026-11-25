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
  defaultPipelineWait,
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
import { automationInputSources, type Automation } from '@dovo/protocol'

export function StepFields({
  data,
  flow,
  nodeId,
  workspace,
  disabled,
  onChange,
}: {
  data: AutomationData
  flow: Automation
  nodeId: string
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
  const wait = data.pipelineWait ?? defaultPipelineWait
  const sources = data.pipelineWait
    ? automationInputSources(flow, nodeId).filter(({ data }) => data.resultSchema !== undefined)
    : []
  return (
    <View style={{ gap: 12 }}>
      <Field
        label={uiText('Step name')}
        value={data.label}
        editable={!disabled}
        onChangeText={(label) => onChange({ label })}
      />
      {data.kind === 'review' && !data.pipelineWait ? (
        snapshot?.automationReviewPromptSupported ? (
          <>
            <Field
              label={uiText('Review instructions')}
              value={data.reviewPrompt?.instructions ?? ''}
              maxLength={4000}
              multiline
              editable={!disabled}
              onChangeText={(instructions) =>
                onChange({ reviewPrompt: { ...data.reviewPrompt, instructions } })
              }
            />
            <Field
              label={uiText('Review link')}
              value={data.reviewPrompt?.link ?? ''}
              maxLength={2000}
              editable={!disabled}
              onChangeText={(link) => onChange({ reviewPrompt: { ...data.reviewPrompt, link } })}
            />
            <Choice
              label={uiText('Require a reason for the decision')}
              value={data.reviewPrompt?.requireReason ? 'yes' : 'no'}
              items={[
                { id: 'no', name: uiText('No') },
                { id: 'yes', name: uiText('Yes') },
              ]}
              disabled={disabled}
              onChange={(value) =>
                onChange({ reviewPrompt: { ...data.reviewPrompt, requireReason: value === 'yes' } })
              }
            />
          </>
        ) : (
          <Text style={styles.muted}>
            <InterfaceText>
              {'Pause here until you approve this run. Rejecting stops the remaining steps.'}
            </InterfaceText>
          </Text>
        )
      ) : data.pipelineWait ? (
        snapshot?.automationPipelineWaitSupported ? (
          <>
            <Choice
              label={uiText('GitHub project')}
              value={data.repositoryId}
              disabled={disabled}
              items={workspace.repositories
                .filter((repo) => !repo.kind)
                .map((repo) => ({ id: repo.id, name: projectDisplayName(repo) }))}
              onChange={(repositoryId) => onChange({ repositoryId })}
            />
            {(sources.length > 0 || wait.resultStepId) && (
              <Choice
                label={uiText('Attempt source')}
                value={wait.resultStepId ?? ''}
                disabled={disabled}
                items={[
                  { id: '', name: uiText('Enter a URL') },
                  ...sources.map((source) => ({ id: source.id, name: source.data.label })),
                ]}
                onChange={(resultStepId) =>
                  onChange({
                    pipelineWait: {
                      ...wait,
                      resultStepId: resultStepId || undefined,
                      url: resultStepId ? '' : wait.url,
                    },
                  })
                }
              />
            )}
            {wait.resultStepId ? (
              <Text style={styles.muted}>
                {uiText('The upstream task must return the attempt URL as a JSON string.')}
              </Text>
            ) : (
              <Field
                label={uiText('GitHub Actions attempt URL')}
                value={wait.url}
                maxLength={512}
                editable={!disabled}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="https://github.com/owner/repo/actions/runs/123/attempts/1"
                onChangeText={(url) => onChange({ pipelineWait: { ...wait, url } })}
              />
            )}
            <Field
              label={uiText('Timeout (minutes)')}
              value={wait.timeoutMinutes ? String(wait.timeoutMinutes) : ''}
              editable={!disabled}
              keyboardType="number-pad"
              maxLength={4}
              onChangeText={(value) => {
                if (/^\d*$/.test(value))
                  onChange({ pipelineWait: { ...wait, timeoutMinutes: Number(value) } })
              }}
            />
          </>
        ) : (
          <Text style={styles.muted}>{uiText('Update this runtime to wait for CI.')}</Text>
        )
      ) : (
        <>
          {data.kind === 'task' && (snapshot?.automationStepPoolsSupported || data.stepPool) && (
            <>
              <Field
                label={uiText('Shared step pool (optional)')}
                value={data.stepPool?.name ?? ''}
                maxLength={120}
                editable={!disabled && !!snapshot?.automationStepPoolsSupported}
                onChangeText={(name) =>
                  onChange({
                    stepPool: name.trim() ? { name, limit: data.stepPool?.limit ?? 1 } : undefined,
                  })
                }
              />
              {data.stepPool && (
                <Field
                  label={uiText('Concurrent steps')}
                  value={data.stepPool.limit ? String(data.stepPool.limit) : ''}
                  keyboardType="number-pad"
                  editable={!disabled && !!snapshot?.automationStepPoolsSupported}
                  onChangeText={(value) => {
                    if (/^\d*$/.test(value))
                      onChange({ stepPool: { name: data.stepPool!.name, limit: Number(value) } })
                  }}
                />
              )}
              {!snapshot?.automationStepPoolsSupported && (
                <Text style={styles.muted}>
                  {uiText('Update this runtime to edit shared step pools.')}
                </Text>
              )}
            </>
          )}
          <Field
            label={uiText('Instructions')}
            value={data.objective}
            editable={!disabled}
            onChangeText={(objective) => onChange({ objective })}
            placeholder={uiText('What should the agent do and verify?')}
            multiline
            style={{ minHeight: 96, textAlignVertical: 'top' }}
          />
          <Field
            label={uiText('Result schema (optional)')}
            value={data.resultSchema ?? ''}
            editable={!disabled && snapshot?.automationStepResultsSupported === true}
            onChangeText={(resultSchema) => onChange({ resultSchema: resultSchema || undefined })}
            maxLength={32000}
            multiline
            style={{ minHeight: 80, textAlignVertical: 'top' }}
          />
          <Text style={styles.muted}>
            {snapshot?.automationStepResultsSupported
              ? uiText('Enter a JSON Schema for the final reply. Leave blank to keep plain text.')
              : uiText('Update this runtime to validate step results.')}
          </Text>
          {!snapshot?.automationStepInputsSupported && (
            <Text style={styles.muted}>
              {uiText('Update this runtime to pass step results and files.')}
            </Text>
          )}
          {automationInputSources(flow, nodeId).map((source) => (
            <Choice
              key={source.id}
              label={uiText('Use result from {label}', { label: source.data.label })}
              value={data.inputFrom?.includes(source.id) ? 'yes' : 'no'}
              items={[
                { id: 'no', name: uiText('No') },
                { id: 'yes', name: uiText('Yes') },
              ]}
              disabled={disabled || !snapshot?.automationStepInputsSupported}
              onChange={(value) =>
                onChange({
                  inputFrom:
                    value === 'yes'
                      ? [...(data.inputFrom ?? []).filter((id) => id !== source.id), source.id]
                      : data.inputFrom?.filter((id) => id !== source.id),
                })
              }
            />
          ))}
          <Choice
            label={uiText('Include result files')}
            value={data.inputFiles ? 'yes' : 'no'}
            items={[
              { id: 'no', name: uiText('No') },
              { id: 'yes', name: uiText('Yes') },
            ]}
            disabled={disabled || !snapshot?.automationStepInputsSupported}
            onChange={(value) => onChange({ inputFiles: value === 'yes' })}
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
                items={selectableAccessModes(
                  agent.permission,
                  agent.provider,
                  agent.acpInstallationId,
                )
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
