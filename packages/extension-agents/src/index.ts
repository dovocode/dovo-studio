import { defineStudioExtension } from '@dovo/studio-core'
export const agentsExtension = defineStudioExtension(
  { id: 'dovo.agents', name: 'Agents', version: '0.1.0' },
  [
    {
      id: 'resources',
      navigationGroup: 'settings',
      settingsScope: 'inherited',
      title: 'MCP, skills & hooks',
      icon: 'agents',
      order: 3,
      settingsSection: 'agents',
      keywords: 'mcp servers skills tools registry integrations hooks formatting checks',
      load: () => import('./resources/view'),
    },
    {
      id: 'text-generation',
      navigationGroup: 'settings',
      settingsScope: 'computer',
      title: 'Titles & dictation',
      icon: 'agents',
      order: 2.2,
      settingsSection: 'agents',
      keywords:
        'text generation title dictation utility speech transcription models reasoning computer',
      load: () => import('./text-generation-view'),
    },
    {
      id: 'agents',
      navigationGroup: 'settings',
      settingsScope: 'inherited',
      title: 'Agents',
      icon: 'agents',
      order: 2,
      settingsSection: 'agents',
      keywords:
        'models defaults providers codex claude opencode hermes copilot grok muse cursor acp permissions access titles dictation',
      load: () => import('./view'),
    },
  ],
)
