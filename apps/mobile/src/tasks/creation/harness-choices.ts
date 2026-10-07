import { decode } from '@dovo/protocol'
import {
  modelDisplayName,
  acpHarnessChoiceId,
  acpHarnessName,
  acpInstallationHarness,
  canChangeTaskProvider,
  defaultTaskHarness,
  resolveProviderAccess,
  lockedTaskProvider,
  lockedAcpInstallationId,
  resolveTaskAgent,
  taskHarnessSchema,
  type Agent,
  type AcpInstallation,
  type Task,
  type RuntimeDefaults,
} from '@dovo/protocol'
export const harnessNames: Record<Agent['provider'], string> = {
  codex: 'Codex',
  claude: 'Claude',
  opencode: 'OpenCode',
  hermes: 'Hermes',
  copilot: 'Copilot',
  grok: 'Grok',
  muse: 'Muse',
  cursor: 'Cursor',
  acp: 'ACP',
}
export function taskHarnessChoices(
  task: Task,
  agents: Agent[],
  installations: readonly AcpInstallation[] = [],
  preferences: RuntimeDefaults['modelPreferences'] = {},
  available?: ReadonlySet<string>,
) {
  const unlocked = canChangeTaskProvider(task)
  const provider = lockedTaskProvider(task, agents)
  const installationId = lockedAcpInstallationId(task, agents)
  return [
    ...(
      ['codex', 'claude', 'opencode', 'hermes', 'copilot', 'grok', 'muse', 'cursor', 'acp'] as const
    ).map((provider) => ({
      id: `harness:${provider}`,
      name: harnessNames[provider],
      provider,
    })),
    ...installations.map((installation) => ({
      id: acpHarnessChoiceId(installation.id),
      name: `${installation.name} · ACP`,
      provider: 'acp' as const,
    })),
    ...agents.map((agent) => ({
      id: `agent:${agent.id}`,
      name: `${agent.name} · ${harnessNames[agent.provider]}`,
      provider: agent.provider,
    })),
  ]
    .filter((choice) => {
      if (available && !available.has(choice.id)) return false
      if (unlocked) return true
      if (choice.provider !== provider) return false
      if (installationId === undefined) return true
      if (choice.id === 'harness:acp') return installationId === ''
      if (choice.id.startsWith('acp:')) return choice.id === acpHarnessChoiceId(installationId)
      const agent = agents.find((entry) => choice.id === `agent:${entry.id}`)
      return (agent?.acpInstallationId ?? '') === installationId
    })
    .sort(
      (a, b) =>
        Number(preferences[b.id]?.favorite ?? false) - Number(preferences[a.id]?.favorite ?? false),
    )
}
export function taskHarnessSelection(task: Task) {
  if (task.agentId) return `agent:${task.agentId}`
  return task.harness
    ? task.harness.provider === 'acp' && task.harness.acpInstallationId
      ? acpHarnessChoiceId(task.harness.acpInstallationId)
      : `harness:${task.harness.provider}`
    : `agent:${task.agentId}`
}
export function selectedTaskHarness(
  task: Task,
  agents: Agent[],
  selection: string,
  installations: readonly AcpInstallation[] = [],
) {
  const choice = taskHarnessChoices(task, agents, installations).find(
    (choice) => choice.id === selection,
  )
  if (!choice) return undefined
  // Re-selecting the current entry must retain its task-specific model and access settings.
  if (selection === taskHarnessSelection(task)) return resolveTaskAgent(task, agents)
  const installation = installations.find((item) => acpHarnessChoiceId(item.id) === selection)
  if (installation)
    return {
      ...acpInstallationHarness(installation, resolveTaskAgent(task, agents)?.permission),
      id: 'task',
      name: installation.name,
    }
  return selection.startsWith('agent:')
    ? agents.find((agent) => agent.id === selection.slice(6))
    : {
        ...defaultTaskHarness(choice.provider),
        permission: resolveProviderAccess(
          choice.provider,
          resolveTaskAgent(task, agents)?.permission ?? 'full-access',
        ),
        id: 'task',
        name: harnessNames[choice.provider],
      }
}
export function taskHarnessChanges(task: Task, selection: string, agent: Agent) {
  const custom = selection.startsWith('agent:')
  return {
    agentId: {
      before: task.agentId,
      after: custom ? selection.slice(6) : '',
    },
    harness: {
      before: task.harness ?? null,
      after: decode(taskHarnessSchema, agent),
    },
    harnessCustomized: { before: task.harnessCustomized ?? null, after: true },
    agentOverrides: {
      before: task.agentOverrides ?? null,
      after: custom
        ? {
            model: agent.model,
            reasoning: agent.reasoning,
            permission: agent.permission,
            serviceTier: agent.serviceTier ?? null,
            cyberAccessProgram: agent.cyberAccessProgram ?? null,
            ...(agent.provider === 'acp'
              ? {
                  acpInstallationId: agent.acpInstallationId ?? null,
                  acpMode: agent.acpMode ?? '',
                  acpConfig: agent.acpConfig ?? {},
                }
              : {}),
          }
        : null,
    },
  }
}
export function taskHarnessLabel(
  task: Task,
  agent: Agent | undefined,
  installations: readonly AcpInstallation[] = [],
  modelName?: string,
  harnessName?: string,
) {
  if (!agent) return 'Choose agent'
  const name = !task.agentId
    ? (acpHarnessName(agent, installations) ?? harnessNames[agent.provider])
    : agent.name
  const model = modelDisplayName(agent.model, modelName)
  if (agent.provider === 'opencode' && harnessName)
    return [!task.agentId ? harnessName : `${name} · ${harnessName}`, model]
      .filter(Boolean)
      .join(' · ')
  return !task.agentId ? model || name : [name, model].filter(Boolean).join(' · ')
}
