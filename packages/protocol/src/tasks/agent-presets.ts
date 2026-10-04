import { defaultTaskHarness, type Agent } from '../workspace.js'

/** Available without creating records; host installations and logins stay on the computer. */
export const builtInAgentDefinitions = [
  {
    provider: 'codex',
    name: 'Codex',
    description: 'Uses your Codex installation and ChatGPT or API login.',
  },
  {
    provider: 'claude',
    name: 'Claude Code',
    description: 'Uses your Claude Code installation and account.',
  },
  {
    provider: 'opencode',
    name: 'OpenCode',
    description: 'Starts a local OpenCode server using your configured providers.',
  },
  {
    provider: 'cursor',
    name: 'Cursor',
    description: 'Uses the Cursor agent SDK and its agent login.',
  },
  {
    provider: 'copilot',
    name: 'GitHub Copilot',
    description: 'Uses your Copilot CLI installation and GitHub login.',
  },
  {
    provider: 'hermes',
    name: 'Hermes',
    description: 'Uses your Hermes installation, memory and skills.',
  },
  {
    provider: 'grok',
    name: 'Grok Build',
    description: 'Uses your Grok CLI installation and account.',
  },
  {
    provider: 'muse',
    name: 'Muse',
    description: 'Uses your local Muse session host and configuration.',
  },
] as const

export function builtInAgentPresets(): Agent[] {
  return builtInAgentDefinitions.map(({ provider, name }) => ({
    ...defaultTaskHarness(provider),
    id: `dovo:${provider}`,
    name,
  }))
}

export function builtInAgentDefinition(id: string) {
  return builtInAgentDefinitions.find(({ provider }) => id === `dovo:${provider}`)
}

export function providerDisplayName(provider: Agent['provider']) {
  return builtInAgentDefinitions.find((entry) => entry.provider === provider)?.name ?? 'ACP agent'
}

/** An explicit server override keeps its launch settings while receiving a newer baseline. */
export function pendingAgentPresets(presets: readonly Agent[], agents: readonly Agent[]) {
  return presets.filter((preset) => {
    const saved = agents.find((agent) => agent.id === preset.id)
    return !saved || JSON.stringify(saved.globalPreset) !== JSON.stringify(preset)
  })
}
