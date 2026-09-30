import { providerSchema, type RuntimeSnapshot, type TaskHarness } from '@dovo/protocol'
export type LauncherAgent = {
  key: string
  name: string
  agentId?: string
  provider: TaskHarness['provider']
  model?: string
  acpInstallationId?: string
}
export function launcherAgents(
  snapshot: RuntimeSnapshot,
  legacyFavorites: readonly string[] = [],
): LauncherAgent[] {
  const preferences = snapshot.defaults?.modelPreferences ?? {}
  const favorites = new Set([
    ...legacyFavorites.filter((key) => preferences[key]?.favorite !== false),
    ...Object.keys(preferences).filter((key) => preferences[key].favorite),
  ])
  return [...favorites].flatMap<LauncherAgent>((key) => {
    if (preferences[key]?.disabled) return []
    if (key.startsWith('agent:')) {
      const agent = snapshot.workspace.agents.find((agent) => agent.id === key.slice(6))
      return agent ? [{ key, name: agent.name, agentId: agent.id, provider: agent.provider }] : []
    }
    const provider = providerSchema.literals.find((provider) => key.startsWith(`${provider}:`))
    if (!provider) return []
    const installation =
      provider === 'acp'
        ? snapshot.acpInstallations?.find((agent) => key.startsWith(`acp:${agent.id}:`))
        : undefined
    if (provider === 'acp' && !installation) return []
    const model = key.slice(installation ? `acp:${installation.id}:`.length : provider.length + 1)
    return [
      {
        key,
        name: `${installation?.name ?? provider} · ${model || 'Default model'}`,
        provider,
        model,
        acpInstallationId: installation?.id,
      },
    ]
  })
}
