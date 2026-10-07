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
      settingsScope: 'inherited',
      title: 'Task defaults',
      icon: 'runtime',
      order: 3,
      settingsSection: 'coding',
      keywords:
        'agent model harness reasoning new task working directory local checkout worktree start from origin fetch remote default branch base setup command install',
      load: () => import('./task-defaults-view'),
    },
    {
      id: 'commands',
      navigationGroup: 'settings',
      settingsScope: 'computer',
      title: 'CLI commands & shell',
      icon: 'runtime',
      order: 4.05,
      settingsSection: 'computers',
      keywords: 'codex claude gh git az path executable shell login terminal',
      load: () => import('./commands-view'),
    },
    {
      id: 'computer-use',
      navigationGroup: 'settings',
      settingsScope: 'computer',
      title: 'Computer use',
      icon: 'runtime',
      order: 4.1,
      settingsSection: 'computers',
      keywords:
        'cua driver desktop install permissions accessibility screen recording history mcp skills daemon',
      load: () => import('./computer-use-view'),
    },
    {
      id: 'worktrees',
      navigationGroup: 'settings',
      settingsScope: 'computer',
      title: 'Worktrees',
      icon: 'runtime',
      order: 3.7,
      settingsSection: 'coding',
      keywords:
        'worktree cleanup storage disk remove delete checkouts branches archived automatic branch prefix name',
      load: () => import('./worktrees-view'),
    },
    {
      id: 'running-tasks',
      navigationGroup: 'settings',
      settingsScope: 'computer',
      title: 'Running tasks',
      icon: 'runtime',
      order: 4.2,
      settingsSection: 'computers',
      keywords:
        'resume continue interrupted restart startup auto archive inactive keep awake sleep caffeinate',
      load: () => import('./running-tasks-view'),
    },
    {
      id: 'activity',
      navigationGroup: 'settings',
      settingsScope: 'computer',
      title: 'Activity & message history',
      icon: 'runtime',
      order: 4.5,
      settingsSection: 'computers',
      keywords: 'log history requests audit messages retention delete disk storage keep days',
      load: () => import('./activity-view'),
    },
  ],
)
