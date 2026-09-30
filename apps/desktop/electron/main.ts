import { registerInputPreview } from './input-preview.js'
import { requireTrustedRenderer, trustedRendererUrl } from './renderer-trust.js'
import { registerUpdates } from './updates.js'
import { registerRemoteUpdates } from './remote-updates.js'
import { registerBrowser } from './browser.js'
import { offerLink } from './links.js'
import {
  startLocalRuntime,
  stopLocalRuntime,
  prepareLocalRuntimeUpdate,
  localRuntimeNetwork,
  setLocalRuntimeNetwork,
} from './local-runtime.js'
import { registerConnectionStorage } from './connection-storage.js'
import {
  desktopProfile,
  migrateDesktopDataDirectory,
  selectDesktopDataDirectory,
} from './data-directory.js'
import { backgroundRuntimeLabel } from './background-runtime.js'
import { readConnection } from '../../api/src/connection.js'
import { execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
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
const nightly = app.isPackaged && /-nightly\.\d+$/.test(app.getVersion())
const appName = !app.isPackaged
  ? 'Dovo Studio (Dev)'
  : nightly
    ? 'Dovo Studio (Nightly)'
    : 'Dovo Studio'
const currentDirectory = app.getPath('userData')
const selectedDirectory = selectDesktopDataDirectory({
  packaged: app.isPackaged,
  explicitDirectory: app.commandLine.hasSwitch('user-data-dir'),
  current: desktopProfile(currentDirectory),
  legacy: desktopProfile(join(app.getPath('appData'), '@dovo', 'desktop')),
  ...(nightly ? { shared: desktopProfile(join(app.getPath('appData'), 'Dovo Studio')) } : {}),
})
const stopRuntimeForMigration = (directory: string) => {
  const discovery = join(directory, 'runtime-connection.json')
  if (!existsSync(discovery)) return
  const { pid } = readConnection(discovery)
  let alive = true
  try {
    process.kill(pid, 0)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') alive = false
    else throw error
  }
  const uid = process.getuid?.()
  if (process.platform !== 'darwin' || uid === undefined) {
    if (alive) throw new Error('Stop the existing runtime before moving desktop data')
    return
  }
  const label = backgroundRuntimeLabel(directory)
  const target = `gui/${uid}/${label}`
  let description: string | null = null
  try {
    description = execFileSync('launchctl', ['print', target], { encoding: 'utf8' })
  } catch {
    if (alive) throw new Error('The running runtime is not managed by this desktop profile')
  }
  if (description) {
    const servicePid = Number(description.match(/(?:^|\n)\s*pid = (\d+)/)?.[1])
    if (Number.isFinite(servicePid) && servicePid > 0 && servicePid !== pid)
      throw new Error('The running service does not match this desktop profile')
    execFileSync('launchctl', ['bootout', target])
    if (alive) {
      let stopped = false
      for (let attempt = 0; attempt < 140; attempt++) {
        try {
          process.kill(pid, 0)
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
            stopped = true
            break
          }
          throw error
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
      }
      if (!stopped) throw new Error('The old runtime did not stop before migration')
    }
  }
  rmSync(join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`), { force: true })
}
let dataDirectory = selectedDirectory
if (!app.commandLine.hasSwitch('user-data-dir')) {
  try {
    dataDirectory = migrateDesktopDataDirectory(
      selectedDirectory,
      join(homedir(), '.dovo', 'desktop'),
      stopRuntimeForMigration,
    )
  } catch (error) {
    console.error(
      'Could not move desktop data to ~/.dovo/desktop; using the existing profile.',
      error,
    )
  }
}
// Development and packaged builds share saved connections, so they must also
// use the same Keychain identity. Preserve the selected profile before renaming.
app.setName('dovo-studio')
app.setPath('userData', dataDirectory)
registerConnectionStorage(join(__dirname, '../dist/index.html'))
const inputPreview = registerInputPreview(rendererPath, join(__dirname, 'preload.mjs'))
app.once('will-quit', () => inputPreview.dispose())
const browserBridge = registerBrowser(
  join(__dirname, '../dist/index.html'),
  app.getPath('userData'),
)
app.once('will-quit', () => {
  void browserBridge.dispose()
})

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 840,
    minHeight: 560,
    title: appName,
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

ipcMain.handle('runtime:network', (event, address: unknown, enabled?: unknown, port?: unknown) => {
  requireTrustedRenderer(event, rendererPath)
  if (
    typeof address !== 'string' ||
    (enabled !== undefined && typeof enabled !== 'boolean') ||
    (port !== undefined && (typeof port !== 'number' || enabled === undefined))
  )
    throw new Error('Invalid runtime network settings')
  return enabled === undefined
    ? localRuntimeNetwork(__dirname, address)
    : setLocalRuntimeNetwork(__dirname, address, enabled, port)
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
    ipcMain.on('app:info', (event) => {
      requireTrustedRenderer(event, rendererPath)
      event.returnValue = {
        version: app.getVersion(),
        channel: !app.isPackaged ? 'dev' : nightly ? 'nightly' : 'stable',
      }
    })
    const updates = registerUpdates(__dirname, async () => {
      const restore = await prepareLocalRuntimeUpdate(__dirname)
      quitting = true
      return async () => {
        quitting = false
        await restore()
      }
    })
    void registerRemoteUpdates(app.getPath('userData'), updates)
      .then((close) => {
        if (close)
          app.once('will-quit', () => {
            void close().catch(console.error)
          })
      })
      .catch((error: unknown) => console.error('Could not enable remote desktop updates:', error))
    ipcMain.handle('updates:state', (event) => {
      requireTrustedRenderer(event, rendererPath)
      return updates.state()
    })
    ipcMain.handle('updates:check', async (event) => {
      requireTrustedRenderer(event, rendererPath)
      await updates.check()
    })
    ipcMain.handle('updates:channel', async (event, channel: unknown) => {
      requireTrustedRenderer(event, rendererPath)
      await updates.setChannel(channel)
    })
    ipcMain.handle('updates:install', async (event) => {
      requireTrustedRenderer(event, rendererPath)
      await updates.install()
    })
    createWindow()
    const checkUpdates = () =>
      void updates
        .refresh()
        .catch((error: unknown) => console.error('Could not check for desktop updates:', error))
    setTimeout(checkUpdates, 5000).unref()
    setInterval(checkUpdates, 60 * 60 * 1000).unref()
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
