import { defineStudioExtension } from '@dovo/studio-core'
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
      title: 'Devices & runtime',
      icon: 'runtime',
      order: 4,
      load: () => import('./view'),
    },
  ],
)
