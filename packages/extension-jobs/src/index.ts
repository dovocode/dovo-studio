import { defineStudioExtension } from '@dovo/studio-core'
export const jobsExtension = defineStudioExtension(
  { id: 'dovo.jobs', name: 'Automations', version: '0.1.0' },
  [{ id: 'jobs', title: 'Automations', icon: 'jobs', order: 3, load: () => import('./view') }],
)
