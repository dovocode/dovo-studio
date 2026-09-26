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
        'send enter shortcut composer follow up queue steer notifications notify sound confirm archive stop cancel automation job run launch startup open time clock 12 24 hour sort order tool activity commands expanded collapsed pull request draft merge squash rebase browser preview viewport phone tablet desktop size',
      load: () => import('./app-settings/general'),
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
