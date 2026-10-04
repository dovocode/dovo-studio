import { resolveProviderAccess } from '../auth/access.js'
import type { Agent, TaskHarness } from '../workspace.js'

/** Launch settings belong to the provider that supplied them. */
export function changeAgentProvider(agent: Agent, provider: TaskHarness['provider']): Agent {
  if (agent.provider === provider) return agent
  return {
    ...agent,
    provider,
    model: '',
    reasoning: '',
    serviceTier: undefined,
    cyberAccessProgram: undefined,
    acpInstallationId: undefined,
    acpMode: undefined,
    acpConfig: undefined,
    endpoint: '',
    executablePath: undefined,
    configDirectory: undefined,
    args: [],
    permission: resolveProviderAccess(provider, agent.permission),
  }
}

export function agentConnectionValue(agent: Agent): string {
  if (agent.provider === 'opencode') return agent.endpoint
  if (agent.acpInstallationId) return agent.executablePath ?? ''
  return agent.executablePath || agent.endpoint
}

export function changeAgentConnection(agent: Agent, value: string): Agent {
  return agent.provider !== 'opencode'
    ? { ...agent, executablePath: value, endpoint: '' }
    : { ...agent, endpoint: value }
}

/** Provider shortcuts must not select an unrelated role using the same provider. */
export function providerConfiguration(
  agents: readonly Agent[],
  installation: { provider: TaskHarness['provider']; name: string; installationId?: string },
) {
  return agents.find(
    (agent) =>
      agent.provider === installation.provider &&
      agent.acpInstallationId === installation.installationId &&
      agent.name.trim().toLowerCase() === installation.name.trim().toLowerCase(),
  )
}
