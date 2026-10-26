import { readLocalSettingsSection } from '@dovo/protocol/local-settings'
import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { randomUUID } from 'node:crypto'
import { requireTrustedRenderer, trustedRendererUrl } from './renderer-trust.js'
import { defaultWindowColors, readWindowColors, titleBarOverlay } from './window-colors.js'
import { offerLink } from './links.js'
import { registerQuitShortcut } from './quit-shortcut.js'

/** Each browser window hosts browser-only controls and its own independent tab workspace. */
export function registerBrowserWindows(rendererPath: string, preload: string) {
  const windows = new Set<BrowserWindow>()
  ipcMain.handle('browser:new-window', async (event) => {
    requireTrustedRenderer(event, rendererPath)
    const settings = readLocalSettingsSection('app')
    if (
      !settings ||
      typeof settings !== 'object' ||
      !('browserWorkspaceEnabled' in settings) ||
      settings.browserWorkspaceEnabled !== true
    )
      throw new Error(
        'Enable experimental Browser in Settings → General before opening a browser window.',
      )
    if (windows.size >= 10) throw new Error('Close a browser window before opening more than 10.')
    const colors =
      readWindowColors(app.getPath('userData')) ??
      defaultWindowColors(nativeTheme.shouldUseDarkColors)
    const window = new BrowserWindow({
      width: 1180,
      height: 800,
      minWidth: 840,
      minHeight: 560,
      title: 'Dovo Browser',
      show: false,
      acceptFirstMouse: true,
      backgroundColor: colors.background,
      titleBarStyle: 'hidden',
      ...(process.platform === 'darwin'
        ? { trafficLightPosition: { x: 16, y: 15 } }
        : { titleBarOverlay: titleBarOverlay(colors), autoHideMenuBar: true }),
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload },
    })
    windows.add(window)
    window.once('closed', () => windows.delete(window))
    window.webContents.setWindowOpenHandler(({ url }) => {
      void offerLink(window, url)
      return { action: 'deny' }
    })
    const guardNavigation = (event: Electron.Event, url: string) => {
      if (!trustedRendererUrl(url, rendererPath, process.env.VITE_DEV_SERVER_URL)) {
        event.preventDefault()
        void offerLink(window, url)
      }
    }
    window.webContents.on('will-navigate', guardNavigation)
    window.webContents.on('will-redirect', guardNavigation)
    registerQuitShortcut(window.webContents)
    const hash = `browser-window=${randomUUID()}`
    try {
      if (process.env.VITE_DEV_SERVER_URL) {
        const url = new URL(process.env.VITE_DEV_SERVER_URL)
        url.hash = hash
        await window.loadURL(url.href)
      } else await window.loadFile(rendererPath, { hash })
      if (!window.isDestroyed()) {
        window.show()
        window.focus()
      }
    } catch (cause) {
      window.destroy()
      throw cause
    }
  })
  return {
    dispose: () => {
      for (const window of windows) window.destroy()
      windows.clear()
    },
  }
}
