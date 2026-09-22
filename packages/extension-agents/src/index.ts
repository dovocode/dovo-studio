import { defineStudioExtension } from '@dovo/studio-core'
export const agentsExtension = defineStudioExtension(
  { id: 'dovo.agents', name: 'Agents', version: '0.1.0' },
  [
    {
      id: 'resources',
      navigationGroup: 'settings',
      title: 'MCP & skills',
      icon: 'agents',
      order: 3,
      load: () => import('./resources/view'),
    },
    {
      id: 'agents',
      navigationGroup: 'settings',
      title: 'Agents',
      icon: 'agents',
      order: 2,
      load: () => import('./view'),
    },
  ],
)
