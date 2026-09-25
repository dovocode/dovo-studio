import { requireTrustedRenderer, trustedRendererUrl } from './renderer-trust.js'
import { registerUpdates } from './updates.js'
import { registerBrowser } from './browser.js'
import {
  startLocalRuntime,
  stopLocalRuntime,
  prepareLocalRuntimeUpdate,
  localRuntimeNetwork,
  setLocalRuntimeNetwork,
} from './local-runtime.js'
import { registerConnectionStorage } from './connection-storage.js'
import { desktopProfile, selectDesktopDataDirectory } from './data-directory.js'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { Effect } from 'effect'

import {
  activateExtension,
  activateOnStartup,
  disposeRuntime,
  listExtensions,
  runDesktop,
} from './runtime.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rendererPath = join(__dirname, '../dist/index.html')
const currentDirectory = app.getPath('userData')
const dataDirectory = selectDesktopDataDirectory({
  packaged: app.isPackaged,
  explicitDirectory: app.commandLine.hasSwitch('user-data-dir'),
  current: desktopProfile(currentDirectory),
  legacy: desktopProfile(join(app.getPath('appData'), '@dovo', 'desktop')),
})
// Development and packaged builds share saved connections, so they must also
// use the same Keychain identity. Preserve the selected profile before renaming.
app.setName('dovo-studio')
app.setPath('userData', dataDirectory)
registerConnectionStorage(join(__dirname, '../dist/index.html'))
registerBrowser(join(__dirname, '../dist/index.html'))

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 840,
    minHeight: 560,
    title: 'Dovo Studio',
    backgroundColor: '#0a0a0a',
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 16, y: 15 } }
      : {
          titleBarOverlay: { color: '#080808', symbolColor: '#a3a3a3', height: 44 },
          autoHideMenuBar: true,
        }),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, 'preload.mjs'),
    },
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const guardNavigation = (event: Electron.Event, url: string) => {
    if (!trustedRendererUrl(url, rendererPath, process.env.VITE_DEV_SERVER_URL))
      event.preventDefault()
  }
  window.webContents.on('will-navigate', guardNavigation)
  window.webContents.on('will-redirect', guardNavigation)

  if (process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    void window.loadFile(join(__dirname, '../dist/index.html'))
  }
}

app.on('second-instance', () => {
  const window = BrowserWindow.getAllWindows()[0]
  if (window?.isMinimized()) window.restore()
  window?.focus()
})

ipcMain.handle('runtime:connection', (event) => {
  requireTrustedRenderer(event, rendererPath)
  return startLocalRuntime(__dirname)
})

ipcMain.handle('runtime:network', (event, address: unknown, enabled?: unknown) => {
  requireTrustedRenderer(event, rendererPath)
  if (typeof address !== 'string' || (enabled !== undefined && typeof enabled !== 'boolean'))
    throw new Error('Invalid runtime network settings')
  return enabled === undefined
    ? localRuntimeNetwork(__dirname, address)
    : setLocalRuntimeNetwork(__dirname, address, enabled)
})

ipcMain.handle('repositories:pick-directory', (event, runtimeAddress: unknown) =>
  runDesktop(
    Effect.tryPromise({
      try: async () => {
        const window = BrowserWindow.fromWebContents(event.sender)
        if (!window || event.senderFrame !== event.sender.mainFrame)
          throw new Error('Folder picker is only available from the desktop window')
        requireTrustedRenderer(event, rendererPath)
        const local = await startLocalRuntime(__dirname)
        if (runtimeAddress !== local.address)
          throw new Error(
            'The system dialog selects folders on this computer. Use Browse in Add project to select a folder on the connected runtime.',
          )
        const result = await dialog.showOpenDialog(window, {
          title: 'Select repository or clone parent folder',
          buttonLabel: 'Select folder',
          properties: ['openDirectory', 'createDirectory'],
        })
        return result.canceled ? null : (result.filePaths[0] ?? null)
      },
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    }),
  ),
)

ipcMain.handle('runtime:list-extensions', (event) => {
  requireTrustedRenderer(event, rendererPath)
  return runDesktop(listExtensions)
})

ipcMain.handle('runtime:activate', async (event, id: unknown) => {
  requireTrustedRenderer(event, rendererPath)
  if (typeof id !== 'string' || id.length > 200) throw new Error('Invalid extension identifier')
  return runDesktop(activateExtension(id))
})

const startup = Effect.gen(function* () {
  yield* Effect.tryPromise({
    try: () => app.whenReady(),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })
  // Show the window immediately; the renderer renders its loading state and awaits
  // runtime:connection itself. Booting the runtime in the background removes the runtime
  // cold-start latency from time-to-first-pixel.
  yield* Effect.sync(() => {
    if (!app.isPackaged && process.platform === 'darwin')
      app.dock?.setIcon(join(__dirname, '../build/icon.png'))
    registerUpdates(__dirname, async () => {
      const restore = await prepareLocalRuntimeUpdate(__dirname)
      quitting = true
      return async () => {
        quitting = false
        await restore()
      }
    })
    createWindow()
  })
  yield* Effect.tryPromise({
    try: () => startLocalRuntime(__dirname),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  }).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        // Keep the window and updater available; the workspace displays connection errors.
        console.error('Local runtime needs attention:', error.message)
      }),
    ),
  )
  yield* activateOnStartup

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

if (!app.requestSingleInstanceLock()) app.quit()
else
  void runDesktop(startup).catch((error: unknown) => {
    console.error('Desktop startup failed:', error)
    app.quit()
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let quitting = false
app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  void Promise.all([stopLocalRuntime(), runDesktop(disposeRuntime)])
    .catch((error) => console.error('Desktop shutdown failed', error))
    .finally(() => app.quit())
})
