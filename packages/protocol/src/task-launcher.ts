export const taskLauncherShortcuts = [
  'CommandOrControl+Shift+Space',
  'CommandOrControl+Alt+N',
  '',
] as const
export type TaskLauncherShortcut = (typeof taskLauncherShortcuts)[number]
export type TaskLauncherBridge = {
  configure: (
    shortcut: TaskLauncherShortcut,
  ) => Promise<{ registered: boolean; error: string | null }>
  sync: (registry: import('./runtime/connection/runtime-fleet.js').RuntimeRegistry) => Promise<void>
  current: () => Promise<import('./runtime/connection/runtime-fleet.js').RuntimeRegistry>
  open: () => Promise<void>
  dismiss: () => Promise<void>
  subscribe: (listener: () => void) => () => void
}
