import { decode } from '@dovo/protocol'
import {
  canChangeTaskProvider,
  defaultTaskHarness,
  lockedTaskProvider,
  resolveTaskAgent,
  taskHarnessSchema,
  type Agent,
  type Task,
} from '@dovo/protocol'
export const harnessNames: Record<Agent['provider'], string> = {
  codex: 'Codex',
  claude: 'Claude',
  opencode: 'OpenCode',
  acp: 'ACP',
}
export function taskHarnessChoices(task: Task, agents: Agent[]) {
  const unlocked = canChangeTaskProvider(task)
  const provider = lockedTaskProvider(task, agents)
  return [
    ...(['codex', 'claude', 'opencode', 'acp'] as const).map((provider) => ({
      id: `harness:${provider}`,
      name: harnessNames[provider],
      provider,
    })),
    ...agents.map((agent) => ({
      id: `agent:${agent.id}`,
      name: `${agent.name} · ${harnessNames[agent.provider]}`,
      provider: agent.provider,
    })),
  ].filter((choice) => unlocked || choice.provider === provider)
}
export function taskHarnessSelection(task: Task) {
  return task.harness ? `harness:${task.harness.provider}` : `agent:${task.agentId}`
}
export function selectedTaskHarness(task: Task, agents: Agent[], selection: string) {
  const choice = taskHarnessChoices(task, agents).find((choice) => choice.id === selection)
  if (!choice) return undefined
  // Re-selecting the current entry must retain its task-specific model and access settings.
  if (selection === taskHarnessSelection(task)) return resolveTaskAgent(task, agents)
  return selection.startsWith('agent:')
    ? agents.find((agent) => agent.id === selection.slice(6))
    : {
        ...defaultTaskHarness(choice.provider),
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
export function taskHarnessLabel(task: Task, agent: Agent | undefined) {
  if (!agent) return 'Choose agent'
  const name = task.harness ? harnessNames[agent.provider] : agent.name
  return task.harness ? agent.model || name : [name, agent.model].filter(Boolean).join(' · ')
}
