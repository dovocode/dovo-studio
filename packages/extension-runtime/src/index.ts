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
      settingsSection: 'computers',
      keywords:
        'computers pair phone connect devices trusted revoke network address tailscale netbird lan',
      load: () => import('./view'),
    },
    {
      id: 'task-defaults',
      navigationGroup: 'settings',
      title: 'Task defaults',
      icon: 'runtime',
      order: 3.5,
      settingsSection: 'coding',
      keywords:
        'worktree checkout execution base branch prefix name remove archived disk setup command resume interrupted restart startup',
      load: () => import('./task-defaults-view'),
    },
    {
      id: 'commands',
      navigationGroup: 'settings',
      title: 'CLI commands & shell',
      icon: 'runtime',
      order: 3.6,
      settingsSection: 'coding',
      keywords: 'codex claude gh git az path executable shell login terminal',
      load: () => import('./commands-view'),
    },
    {
      id: 'worktrees',
      navigationGroup: 'settings',
      title: 'Worktrees',
      icon: 'runtime',
      order: 3.7,
      settingsSection: 'coding',
      keywords: 'worktree cleanup storage disk remove delete checkouts branches archived automatic',
      load: () => import('./worktrees-view'),
    },
    {
      id: 'activity',
      navigationGroup: 'settings',
      title: 'Activity & message history',
      icon: 'runtime',
      order: 4.5,
      settingsSection: 'computers',
      keywords: 'log history requests audit messages retention delete disk storage keep days',
      load: () => import('./activity-view'),
    },
  ],
)
