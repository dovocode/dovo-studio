import { runtimeSettings } from './settings-views'
import { defineStudioExtension } from '@dovo/studio-core'
export { WindowsRuntimeGate } from './windows-runtime'
export const runtimeExtension = defineStudioExtension(
  {
    id: 'dovo.runtime',
    name: 'Devices & runtime',
    version: '0.1.0',
  },
  [
    {
      id: 'runtime',
      navigationGroup: 'settings',
      settingsScope: 'computer',
      title: 'Devices & runtime',
      settingsFields: ['Dovo Connect URL', 'Dovo Artifacts URL'],
      icon: 'runtime',
      order: 4,
      settingsSection: 'computers',
      keywords:
        'computers pair phone connect devices trusted revoke network address tailscale netbird lan services custom self-hosted artifacts url',
      load: () => import('./view'),
    },
    ...runtimeSettings,
  ],
)
