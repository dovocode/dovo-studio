import { app, BrowserWindow, globalShortcut, ipcMain, nativeTheme, screen } from 'electron'
import {
  decode,
  runtimeRegistrySchema,
  taskLauncherShortcuts,
  type RuntimeRegistry,
} from '@dovo/protocol'
import { requireTrustedRenderer, trustedRendererUrl } from './renderer-trust.js'
import { defaultWindowColors, readWindowColors } from './window-colors.js'

/** Popups open before their renderer paints; match the main window's last palette. */
const popupBackground = () =>
  (
    readWindowColors(app.getPath('userData')) ??
    defaultWindowColors(nativeTheme.shouldUseDarkColors)
  ).background
export function registerTaskLauncher(rendererPath: string, preload: string) {
  let shortcut = ''
  let popup: BrowserWindow | undefined
  let ready = false
  let pending = false
  let quitting = false
  let registry: RuntimeRegistry = { version: 1, activeId: null, profiles: [] }
  app.on('before-quit', () => {
    quitting = true
  })
  const authorizeMain = (event: Electron.IpcMainInvokeEvent) => {
    requireTrustedRenderer(event, rendererPath)
    if (new URL(event.sender.getURL()).hash)
      throw new Error('Only the main window can configure the task launcher')
  }
  const authorizePopup = (event: Electron.IpcMainInvokeEvent) => {
    requireTrustedRenderer(event, rendererPath)
    if (event.sender !== popup?.webContents)
      throw new Error('Only the task launcher can access this request')
  }
  const open = () => {
    if (!popup || popup.isDestroyed()) {
      ready = false
      popup = new BrowserWindow({
        width: 620,
        height: 670,
        minWidth: 460,
        minHeight: 420,
        title: 'Dovo · Quick task',
        frame: false,
        show: false,
        alwaysOnTop: true,
        ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
        backgroundColor: popupBackground(),
        autoHideMenuBar: true,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload },
      })
      popup.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      const guardNavigation = (event: Electron.Event, url: string) => {
        if (!trustedRendererUrl(url, rendererPath, process.env.VITE_DEV_SERVER_URL))
          event.preventDefault()
      }
      popup.webContents.on('will-navigate', guardNavigation)
      popup.webContents.on('will-redirect', guardNavigation)
      popup.on('close', (event) => {
        if (quitting) return
        event.preventDefault()
        popup?.hide()
      })
      if (process.env.VITE_DEV_SERVER_URL) {
        const url = new URL(process.env.VITE_DEV_SERVER_URL)
        url.hash = 'task-launcher'
        void popup.loadURL(url.href)
      } else void popup.loadFile(rendererPath, { hash: 'task-launcher' })
    }
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    const [width, height] = popup.getSize()
    popup.setPosition(
      area.x + Math.max(0, (area.width - width) / 2),
      area.y + Math.max(0, (area.height - height) / 3),
    )
    popup.show()
    popup.focus()
    if (ready) popup.webContents.send('task-launcher:open')
    else pending = true
  }
  ipcMain.handle('task-launcher:sync', (event, value: unknown) => {
    authorizeMain(event)
    registry = decode(runtimeRegistrySchema, value)
  })
  ipcMain.handle('task-launcher:current', (event) => {
    authorizePopup(event)
    return registry
  })
  ipcMain.handle('task-launcher:dismiss', (event) => {
    authorizePopup(event)
    popup?.hide()
  })
  ipcMain.handle('task-launcher:open', (event) => {
    authorizeMain(event)
    open()
  })
  ipcMain.handle('task-launcher:configure', (event, value: unknown) => {
    authorizeMain(event)
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
    authorizePopup(event)
    ready = true
    if (pending) {
      pending = false
      popup?.webContents.send('task-launcher:open')
    }
  })
  return {
    dispose: () => {
      if (shortcut) globalShortcut.unregister(shortcut)
      popup?.destroy()
    },
  }
}
