import { defineStudioExtension } from '@dovo/studio-core'
export const agentsExtension = defineStudioExtension(
  { id: 'dovo.agents', name: 'Agents', version: '0.1.0' },
  [
    {
      id: 'resources',
      navigationGroup: 'settings',
      title: 'Resources & hooks',
      icon: 'agents',
      order: 3,
      settingsSection: 'agents',
      keywords: 'mcp servers skills tools registry integrations hooks formatting checks',
      load: () => import('./resources/view'),
    },
    {
      id: 'agents',
      navigationGroup: 'settings',
      title: 'Agents',
      icon: 'agents',
      order: 2,
      settingsSection: 'agents',
      keywords:
        'models defaults providers codex claude opencode hermes copilot grok muse acp permissions access titles dictation',
      load: () => import('./view'),
    },
  ],
)
