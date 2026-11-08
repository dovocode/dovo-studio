import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron'
import { decode, threadWindowTargetSchema } from '@dovo/protocol'
import { requireTrustedRenderer, trustedRendererUrl } from './renderer-trust.js'
import { defaultWindowColors, readWindowColors, titleBarOverlay } from './window-colors.js'
import { offerLink } from './links.js'
import { registerQuitShortcut } from './quit-shortcut.js'

/** A pop-out stays registered while it loads so a repeated request focuses it once it is
 * ready, rather than showing a blank window early or opening a duplicate. */
interface ThreadWindowEntry {
  window: BrowserWindow
  ready: Promise<void>
}
/** Automatic reloads of a crashed pop-out are spaced at least this far apart; a second crash
 * inside the window asks the person instead of looping. */
const RELOAD_INTERVAL = 60_000

export function registerThreadWindows(rendererPath: string, preload: string) {
  const windows = new Map<string, ThreadWindowEntry>()
  const focus = (window: BrowserWindow) => {
    if (window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }
  /** A crashed or hung pop-out renderer must not linger as a blank window that every later
   * pop-out request keeps focusing. Reload once per minute; afterwards let the person choose. */
  const guardRenderer = (window: BrowserWindow, title: string) => {
    let reloadedAt = 0
    window.webContents.on('render-process-gone', (_event, details) => {
      if (window.isDestroyed() || details.reason === 'clean-exit') return
      console.error(
        `Thread window renderer gone (${details.reason}, exit code ${details.exitCode}): ${title}`,
      )
      if (Date.now() - reloadedAt > RELOAD_INTERVAL) {
        reloadedAt = Date.now()
        window.webContents.reload()
        return
      }
      void dialog
        .showMessageBox(window, {
          type: 'error',
          title: app.getName(),
          message: 'This thread window stopped unexpectedly.',
          detail: `Reason: ${details.reason}. The thread keeps running on its runtime; reopening the window restores it.`,
          buttons: ['Reload', 'Close window'],
          defaultId: 0,
          cancelId: 1,
        })
        .then(({ response }) => {
          if (window.isDestroyed()) return
          if (response === 0) window.webContents.reload()
          else window.destroy()
        })
        .catch((error: unknown) => console.error('Thread window recovery prompt failed', error))
    })
    window.webContents.on('unresponsive', () => {
      if (window.isDestroyed()) return
      void dialog
        .showMessageBox(window, {
          type: 'warning',
          title: app.getName(),
          message: 'This thread window is not responding.',
          detail:
            'Wait for it to recover, or reload the window. The thread keeps running on its runtime.',
          buttons: ['Wait', 'Reload'],
          defaultId: 0,
          cancelId: 0,
        })
        .then(({ response }) => {
          if (!window.isDestroyed() && response === 1) window.webContents.forcefullyCrashRenderer()
        })
        .catch((error: unknown) => console.error('Thread window recovery prompt failed', error))
    })
  }
  ipcMain.handle('thread:pop-out', async (event, value: unknown) => {
    requireTrustedRenderer(event, rendererPath)
    const target = decode(threadWindowTargetSchema, value)
    const key = JSON.stringify([target.runtimeId, target.taskId])
    const existing = windows.get(key)
    if (existing && !existing.window.isDestroyed()) {
      await existing.ready
      focus(existing.window)
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
    const release = () => {
      if (windows.get(key)?.window === window) windows.delete(key)
    }
    window.once('closed', release)
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
    guardRenderer(window, target.title)
    const hash = 'thread=' + encodeURIComponent(JSON.stringify(target))
    const ready = (async () => {
      if (process.env.VITE_DEV_SERVER_URL) {
        const url = new URL(process.env.VITE_DEV_SERVER_URL)
        url.hash = hash
        await window.loadURL(url.href)
      } else await window.loadFile(rendererPath, { hash })
      if (!window.isDestroyed()) {
        window.show()
        window.focus()
      }
    })()
    // Concurrent requests wait on the load but must not fail with it; the opener gets the error.
    windows.set(key, { window, ready: ready.catch(() => undefined) })
    try {
      await ready
    } catch (cause) {
      release()
      if (!window.isDestroyed()) window.destroy()
      throw cause
    }
  })
  return {
    dispose: () => {
      for (const { window } of windows.values()) if (!window.isDestroyed()) window.destroy()
      windows.clear()
    },
  }
}
