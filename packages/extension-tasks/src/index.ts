import { defineStudioExtension } from '@dovo/studio-core'
export const tasksExtension = defineStudioExtension(
  { id: 'dovo.tasks', name: 'Threads', version: '0.1.0' },
  [
    { id: 'tasks', title: 'Threads', icon: 'tasks', order: 0, load: () => import('./view') },
    {
      id: 'browser',
      title: 'Browser',
      icon: 'browser',
      order: 0.25,
      load: () => import('./browser/browser-view'),
    },
    {
      id: 'artifacts',
      title: 'Artifacts',
      icon: 'artifacts',
      order: 0.5,
      keywords: 'documents previews html svg code artifacts',
      load: () => import('./artifacts-view'),
    },
    {
      id: 'archived-tasks',
      title: 'Archived threads',
      icon: 'tasks',
      order: 9,
      navigationGroup: 'settings',
      settingsSection: 'archived',
      keywords: 'archive restore threads history deleted old',
      load: () => import('./list/archived-view'),
    },
  ],
)
