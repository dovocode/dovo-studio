import { BrowserWindow, dialog } from 'electron'

/** Electron cancels beforeunload without a browser prompt. Ask explicitly for Studio windows. */
export function registerWindowUnload(window: BrowserWindow) {
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

/** Close renderers before stopping the runtime. A cancelled close must leave saves usable. */
export async function closeStudioWindows() {
  for (const window of BrowserWindow.getAllWindows()) {
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
