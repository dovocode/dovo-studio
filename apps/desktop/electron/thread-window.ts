import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { decode, threadWindowTargetSchema } from '@dovo/protocol'
import { requireTrustedRenderer, trustedRendererUrl } from './renderer-trust.js'
import { defaultWindowColors, readWindowColors, titleBarOverlay } from './window-colors.js'
import { offerLink } from './links.js'
import { registerQuitShortcut } from './quit-shortcut.js'

export function registerThreadWindows(rendererPath: string, preload: string) {
  const windows = new Map<string, BrowserWindow>()
  ipcMain.handle('thread:pop-out', async (event, value: unknown) => {
    requireTrustedRenderer(event, rendererPath)
    const target = decode(threadWindowTargetSchema, value)
    const key = JSON.stringify([target.runtimeId, target.taskId])
    const existing = windows.get(key)
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore()
      existing.show()
      existing.focus()
      return
    }
    const colors =
      readWindowColors(app.getPath('userData')) ??
      defaultWindowColors(nativeTheme.shouldUseDarkColors)
    const window = new BrowserWindow({
      width: 1000,
      height: 760,
      minWidth: 640,
      minHeight: 480,
      title: `Dovo · ${target.title}`,
      show: false,
      backgroundColor: colors.background,
      titleBarStyle: 'hidden',
      ...(process.platform === 'darwin'
        ? { trafficLightPosition: { x: 16, y: 15 } }
        : { titleBarOverlay: titleBarOverlay(colors), autoHideMenuBar: true }),
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload },
    })
    windows.set(key, window)
    window.once('closed', () => {
      if (windows.get(key) === window) windows.delete(key)
    })
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
    const hash = 'thread=' + encodeURIComponent(JSON.stringify(target))
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
      for (const window of windows.values()) window.destroy()
      windows.clear()
    },
  }
}
