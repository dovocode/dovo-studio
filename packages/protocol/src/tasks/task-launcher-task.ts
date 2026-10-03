import { defaultTaskHarness, type Repository, type Task } from '../workspace.js'
import type { RuntimeSnapshot } from '../runtime/connection/runtime.js'
import { resolveTaskDefaults } from '../runtime/connection/runtime-setup.js'
import { supportsAccess } from '../auth/access.js'
import type { LauncherAgent } from './task-launcher-choices.js'

export function createLauncherTask(
  snapshot: RuntimeSnapshot,
  repository: Repository,
  agent: LauncherAgent,
  text: string,
  id: string,
  createdAt = new Date().toISOString(),
): Task {
  const defaults = resolveTaskDefaults(snapshot.defaults, repository)
  const base =
    defaults.harness.provider === agent.provider &&
    (agent.provider !== 'acp' || defaults.harness.acpInstallationId === agent.acpInstallationId)
      ? defaults.harness
      : {
          ...defaultTaskHarness(agent.provider),
          permission: supportsAccess(agent.provider, defaults.harness.permission)
            ? defaults.harness.permission
            : 'ask',
        }
  return {
    ...defaults,
    id,
    title: text.trim().split('\n')[0].slice(0, 80) || 'New task',
    repositoryId: repository.id,
    agentId: agent.agentId ?? '',
    agentOverrides:
      agent.agentId && agent.harness
        ? {
            model: agent.harness.model,
            reasoning: agent.harness.reasoning ?? '',
            permission: agent.harness.permission,
            serviceTier: agent.harness.serviceTier ?? null,
            cyberAccessProgram: agent.harness.cyberAccessProgram ?? null,
            ...(agent.provider === 'acp'
              ? {
                  acpInstallationId: agent.harness.acpInstallationId ?? null,
                  acpMode: agent.harness.acpMode ?? '',
                  acpConfig: agent.harness.acpConfig ?? {},
                }
              : {}),
          }
        : undefined,
    agentName: agent.agentId ? agent.name : undefined,
    harness: agent.agentId
      ? agent.harness
      : (agent.harness ?? {
          ...base,
          model: agent.model ?? '',
          acpInstallationId: agent.acpInstallationId,
        }),
    status: 'draft',
    createdAt,
    messages: [],
    files: [],
    draft: '',
    example: false,
  }
}

export function launcherDefaultAgent(
  snapshot: RuntimeSnapshot,
  repository: Repository,
): LauncherAgent {
  const defaults = resolveTaskDefaults(snapshot.defaults, repository)
  const harness = defaults.harness
  return {
    key: `harness:${harness.provider}`,
    name: harness.provider,
    provider: harness.provider,
    model: harness.model,
    acpInstallationId: harness.acpInstallationId,
    harness,
  }
}
