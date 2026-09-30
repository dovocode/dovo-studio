import { globalShortcut, ipcMain, type BrowserWindow } from 'electron'
import { taskLauncherShortcuts } from '@dovo/protocol'
import { requireTrustedRenderer } from './renderer-trust.js'

export function registerTaskLauncher(rendererPath: string, showWindow: () => BrowserWindow) {
  let shortcut = ''
  let pending = false
  let ready: Electron.WebContents | undefined
  const authorize = (event: Electron.IpcMainInvokeEvent) => {
    requireTrustedRenderer(event, rendererPath)
    if (new URL(event.sender.getURL()).hash)
      throw new Error('Only the main window can configure the task launcher')
  }
  const open = () => {
    const window = showWindow()
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    if (ready === window.webContents && !ready.isDestroyed()) ready.send('task-launcher:open')
    else pending = true
  }
  ipcMain.handle('task-launcher:configure', (event, value: unknown) => {
    authorize(event)
    if (!taskLauncherShortcuts.some((option) => option === value))
      throw new Error('Invalid shortcut')
    if (value === shortcut) return { registered: !!shortcut, error: null }
    if (shortcut) globalShortcut.unregister(shortcut)
    shortcut = ''
    if (!value) return { registered: false, error: null }
    if (typeof value !== 'string' || !globalShortcut.register(value, open))
      return {
        registered: false,
        error: 'This shortcut is unavailable. Choose another in General settings.',
      }
    shortcut = value
    return { registered: true, error: null }
  })
  ipcMain.handle('task-launcher:ready', (event) => {
    authorize(event)
    ready = event.sender
    if (pending) {
      pending = false
      ready.send('task-launcher:open')
    }
  })
  return {
    dispose: () => {
      if (shortcut) globalShortcut.unregister(shortcut)
    },
  }
}
