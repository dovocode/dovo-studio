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
  subscribe: (listener: () => void) => () => void
}
