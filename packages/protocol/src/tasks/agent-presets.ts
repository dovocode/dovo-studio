import { defaultTaskHarness, type Agent } from '../workspace.js'

/** Available without creating records; host installations and logins stay on the computer. */
export const builtInAgentDefinitions = [
  {
    id: 'dovo:codex',
    provider: 'codex',
    name: 'Codex',
    description: 'Uses your Codex installation and ChatGPT or API login.',
  },
  {
    id: 'dovo:claude',
    provider: 'claude',
    name: 'Claude Code',
    description: 'Uses your Claude Code installation and account.',
  },
  {
    id: 'dovo:vibe',
    provider: 'vibe',
    name: 'Mistral Vibe',
    description: 'Uses your Mistral Vibe app server and configured credentials.',
  },
  {
    id: 'dovo:opencode',
    provider: 'opencode',
    name: 'OpenCode',
    description: 'Starts a local OpenCode server using your configured providers.',
  },
  {
    id: 'dovo:cursor',
    provider: 'cursor',
    name: 'Cursor',
    description: 'Uses the Cursor agent SDK and its agent login.',
  },
  {
    id: 'dovo:copilot',
    provider: 'copilot',
    name: 'GitHub Copilot',
    description: 'Uses your Copilot CLI installation and GitHub login.',
  },
  {
    id: 'dovo:hermes',
    provider: 'hermes',
    name: 'Hermes',
    description: 'Uses your Hermes installation, memory and skills.',
  },
  {
    id: 'dovo:grok',
    provider: 'grok',
    name: 'Grok Build',
    description: 'Uses your Grok CLI installation and account.',
  },
  {
    id: 'dovo:muse',
    provider: 'muse',
    name: 'Muse',
    description: 'Uses your local Muse session host and configuration.',
  },
  {
    id: 'dovo:antigravity',
    provider: 'acp',
    name: 'Antigravity',
    description: 'Uses your installed agy CLI with agy acp and its Google login.',
    endpoint: 'agy',
    args: ['acp'],
  },
] as const

export function builtInAgentPresets(): Agent[] {
  return builtInAgentDefinitions.map((definition) => ({
    ...defaultTaskHarness(definition.provider),
    id: definition.id,
    name: definition.name,
    ...('endpoint' in definition
      ? { endpoint: definition.endpoint, args: [...definition.args] }
      : {}),
  }))
}

export function builtInAgentDefinition(id: string) {
  return builtInAgentDefinitions.find((definition) => id === definition.id)
}

export function providerDisplayName(provider: Agent['provider']) {
  if (provider === 'acp') return 'ACP agent'
  return builtInAgentDefinitions.find((entry) => entry.provider === provider)?.name ?? 'ACP agent'
}

/** An explicit server override keeps its launch settings while receiving a newer baseline. */
export function pendingAgentPresets(presets: readonly Agent[], agents: readonly Agent[]) {
  return presets.filter((preset) => {
    const saved = agents.find((agent) => agent.id === preset.id)
    return !saved || JSON.stringify(saved.globalPreset) !== JSON.stringify(preset)
  })
}
