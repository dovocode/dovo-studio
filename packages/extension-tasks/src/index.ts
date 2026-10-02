import { defineStudioExtension } from '@dovo/studio-core'
export const tasksExtension = defineStudioExtension(
  { id: 'dovo.tasks', name: 'Tasks', version: '0.1.0' },
  [
    { id: 'tasks', title: 'Tasks', icon: 'tasks', order: 0, load: () => import('./view') },
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
      title: 'Archived tasks',
      icon: 'tasks',
      order: 9,
      navigationGroup: 'settings',
      settingsSection: 'archived',
      keywords: 'archive restore threads history deleted old',
      load: () => import('./list/archived-view'),
    },
  ],
)
