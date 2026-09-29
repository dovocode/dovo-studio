import { decode } from '@dovo/protocol'
import {
  acpHarnessChoiceId,
  acpHarnessName,
  acpInstallationHarness,
  canChangeTaskProvider,
  defaultTaskHarness,
  lockedTaskProvider,
  lockedAcpInstallationId,
  resolveTaskAgent,
  taskHarnessSchema,
  type Agent,
  type AcpInstallation,
  type Task,
} from '@dovo/protocol'
export const harnessNames: Record<Agent['provider'], string> = {
  codex: 'Codex',
  claude: 'Claude',
  opencode: 'OpenCode',
  acp: 'ACP',
}
export function taskHarnessChoices(
  task: Task,
  agents: Agent[],
  installations: readonly AcpInstallation[] = [],
) {
  const unlocked = canChangeTaskProvider(task)
  const provider = lockedTaskProvider(task, agents)
  const installationId = lockedAcpInstallationId(task, agents)
  return [
    ...(['codex', 'claude', 'opencode', 'acp'] as const).map((provider) => ({
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
  ].filter((choice) => {
    if (unlocked) return true
    if (choice.provider !== provider) return false
    if (installationId === undefined) return true
    if (choice.id === 'harness:acp') return installationId === ''
    if (choice.id.startsWith('acp:')) return choice.id === acpHarnessChoiceId(installationId)
    const agent = agents.find((entry) => choice.id === `agent:${entry.id}`)
    return (agent?.acpInstallationId ?? '') === installationId
  })
}
export function taskHarnessSelection(task: Task) {
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
        permission: resolveTaskAgent(task, agents)?.permission ?? 'full-access',
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
      after: custom ? null : decode(taskHarnessSchema, agent),
    },
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
) {
  if (!agent) return 'Choose agent'
  const name = task.harness
    ? (acpHarnessName(agent, installations) ?? harnessNames[agent.provider])
    : agent.name
  return task.harness ? agent.model || name : [name, agent.model].filter(Boolean).join(' · ')
}
