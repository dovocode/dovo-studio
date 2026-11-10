import { dialog, type BrowserWindow } from 'electron'

const studioWindows = new Set<BrowserWindow>()

/** Electron cancels beforeunload without a browser prompt. Ask explicitly for Studio windows. */
export function registerWindowUnload(window: BrowserWindow) {
  if (studioWindows.has(window)) return
  studioWindows.add(window)
  window.once('closed', () => studioWindows.delete(window))
  window.webContents.on('will-prevent-unload', (event) => {
    const response = dialog.showMessageBoxSync(window, {
      type: 'warning',
      message: 'Keep unsaved changes?',
      detail:
        'Choose Keep editing to save or download your edits. Discard changes closes or reloads this window without saving.',
      buttons: ['Keep editing', 'Discard changes'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    // For will-prevent-unload, preventDefault permits the unload.
    if (response === 1) event.preventDefault()
  })
}

/** Close document windows before stopping the runtime. Auxiliary panels hide on close and
 * cannot finish this phase; Electron closes them when the installer actually quits the app. */
export async function closeStudioWindows() {
  for (const window of [...studioWindows]) {
    if (window.isDestroyed()) continue
    const contents = window.webContents
    const closed = await new Promise<boolean>((resolve) => {
      const finish = (closed: boolean) => {
        window.removeListener('closed', onClosed)
        contents.removeListener('will-prevent-unload', onPrevented)
        resolve(closed)
      }
      const onClosed = () => finish(true)
      const onPrevented = (event: Electron.Event) => {
        if (!event.defaultPrevented) finish(false)
      }
      window.once('closed', onClosed)
      contents.on('will-prevent-unload', onPrevented)
      window.close()
    })
    if (!closed) return false
  }
  return true
}
