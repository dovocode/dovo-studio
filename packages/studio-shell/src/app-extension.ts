import { defineStudioExtension } from '@dovo/studio-core'

/** App-level settings shipped with the shell on desktop and web. */
export const appSettingsExtension = defineStudioExtension(
  { id: 'dovo.app', name: 'App', version: '0.1.0' },
  [
    {
      id: 'general',
      navigationGroup: 'settings',
      title: 'General',
      icon: 'runtime',
      order: 0.1,
      settingsSection: 'app',
      keywords:
        'send enter shortcut composer conversation chat follow up queue steer confirm archive stop cancel launch startup open time clock 12 24 hour sort order tool activity commands expanded collapsed browser preview viewport phone tablet desktop size',
      load: () => import('./app-settings/general'),
    },
    {
      id: 'notifications',
      navigationGroup: 'settings',
      title: 'Notifications',
      icon: 'runtime',
      order: 0.15,
      settingsSection: 'app',
      keywords:
        'notifications notify alert sound background input approval question finished failed automation job run',
      load: () => import('./app-settings/notifications'),
    },
    {
      id: 'appearance',
      navigationGroup: 'settings',
      title: 'Appearance',
      icon: 'runtime',
      order: 0.2,
      settingsSection: 'app',
      keywords: 'theme dark light system mode color text size font zoom motion animation reduce',
      load: () => import('./app-settings/appearance'),
    },
    {
      id: 'diffs',
      navigationGroup: 'settings',
      title: 'Diffs',
      icon: 'runtime',
      order: 0.25,
      settingsSection: 'app',
      keywords:
        'diff review split unified wrap scroll line numbers word character highlight changes',
      load: () => import('./app-settings/diffs'),
    },
    {
      id: 'pull-request-settings',
      navigationGroup: 'settings',
      title: 'Pull requests',
      icon: 'runtime',
      order: 3.1,
      settingsSection: 'coding',
      keywords: 'pull request pr draft merge squash rebase method create',
      load: () => import('./app-settings/pull-requests'),
    },
    {
      id: 'usage',
      navigationGroup: 'settings',
      title: 'Usage & limits',
      icon: 'runtime',
      order: 0.12,
      settingsSection: 'app',
      keywords:
        'usage limits quota allowance reset codex claude tokens time turns models statistics week month',
      load: () => import('./app-settings/usage'),
    },
    {
      id: 'shortcuts',
      navigationGroup: 'settings',
      title: 'Keyboard shortcuts',
      icon: 'runtime',
      order: 0.3,
      settingsSection: 'app',
      keywords: 'keyboard shortcuts hotkeys keys bindings command palette',
      load: () => import('./app-settings/shortcuts'),
    },
  ],
)
