import { checkRuntimeConnection } from './runtime-connection-health.js'
import { configureDesktopRuntimeDirectory, desktopDataRoot } from './runtime-data-directory.js'
import { registerQuitShortcut } from './quit-shortcut.js'
import { registerLinuxDesktop } from './linux-desktop.js'
import { registerInputPreview } from './input-preview.js'
import { decode, windowsRuntimeChoiceSchema, windowsRuntimeErrorMessage } from '@dovo/protocol'
import { readWindowsSecurity } from './windows-security.js'
import {
  windowsRuntimeStatus,
  readWindowsRuntimeChoice,
  writeWindowsRuntimeChoice,
  prepareWslRuntime,
} from './windows-runtime.js'
import { registerTaskLauncher } from './task-launcher.js'
import { requireTrustedRenderer, trustedRendererUrl } from './renderer-trust.js'
import { registerUpdates } from './updates.js'
import { registerRemoteUpdates } from './remote-updates.js'
import { registerBrowser } from './browser.js'
import { offerLink, openExternalLink } from './links.js'
import {
  startLocalRuntime,
  stopLocalRuntime,
  prepareLocalRuntimeUpdate,
  localRuntimeNetwork,
  setLocalRuntimeNetwork,
  pauseLocalRuntime,
} from './local-runtime.js'
import { registerConnectionStorage } from './connection-storage.js'
import {
  defaultWindowColors,
  parseWindowColors,
  readWindowColors,
  titleBarOverlay,
  writeWindowColors,
} from './window-colors.js'
import {
  desktopProfile,
  migrateDesktopDataDirectory,
  restoreElectronProfile,
  selectDesktopDataDirectory,
} from './data-directory.js'
import { backgroundRuntimeLabel } from './background-runtime.js'
import { readConnection } from '../../api/src/connection.js'
import { execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron'
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
const explicitDirectory = app.commandLine.hasSwitch('user-data-dir')
const dataRoot = process.env.DOVO_DATA_ROOT ?? desktopDataRoot(homedir(), app.isPackaged)
const currentDirectory =
  !app.isPackaged && !explicitDirectory
    ? join(app.getPath('appData'), appName)
    : app.getPath('userData')
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
if (!explicitDirectory) {
  try {
    dataDirectory = migrateDesktopDataDirectory(
      selectedDirectory,
      join(dataRoot, 'desktop'),
      stopRuntimeForMigration,
    )
  } catch (error) {
    console.error('Could not move desktop runtime data; using the existing workspace.', error)
  }
}
// Preserve the established Keychain identity while restoring native Electron storage.
app.setName('dovo-studio')
configureDesktopRuntimeDirectory(dataDirectory)
process.env.DOVO_DATA_ROOT = dataRoot
process.env.DOVO_SETTINGS_PATH = join(dataRoot, 'settings.json')
if (!explicitDirectory) {
  try {
    restoreElectronProfile(dataDirectory, currentDirectory)
  } catch (error) {
    console.error('Could not restore Electron profile; existing files have been preserved.', error)
  }
}
app.setPath('userData', currentDirectory)
app.setPath('sessionData', currentDirectory)
registerLinuxDesktop(nightly, appName, rendererPath)
registerConnectionStorage(join(__dirname, '../dist/index.html'))
const inputPreview = registerInputPreview(rendererPath, join(__dirname, 'preload.mjs'))
app.once('will-quit', () => inputPreview.dispose())
const browserBridge = registerBrowser(join(__dirname, '../dist/index.html'), dataDirectory)
app.once('will-quit', () => {
  void browserBridge.dispose()
})

const taskLauncher = registerTaskLauncher(rendererPath, join(__dirname, 'preload.mjs'))
app.once('will-quit', () => taskLauncher.dispose())
let mainWindow: BrowserWindow | undefined
/** The renderer reports its resolved palette; Windows and Linux paint the caption buttons
 * natively, so they would otherwise stay dark on a light theme. The last palette is kept for
 * the next launch, before any renderer has painted. */
ipcMain.handle('window:colors', (event, value: unknown) => {
  requireTrustedRenderer(event, rendererPath)
  const colors = parseWindowColors(value)
  if (!colors) throw new Error('Expected window colours as six-digit hex values')
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || window.isDestroyed()) return
  window.setBackgroundColor(colors.background)
  if (window === mainWindow && process.platform !== 'darwin')
    window.setTitleBarOverlay(titleBarOverlay(colors))
  writeWindowColors(app.getPath('userData'), colors)
})
function createWindow(): void {
  const colors =
    readWindowColors(app.getPath('userData')) ??
    defaultWindowColors(nativeTheme.shouldUseDarkColors)
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 840,
    minHeight: 560,
    title: appName,
    backgroundColor: colors.background,
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 16, y: 15 } }
      : {
          titleBarOverlay: titleBarOverlay(colors),
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
  mainWindow = window
  window.once('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })
  registerQuitShortcut(window.webContents)
  window.webContents.on('will-navigate', guardNavigation)
  window.webContents.on('will-redirect', guardNavigation)
  // A crashed or hung renderer must not leave a blank or frozen window. Reload once per
  // minute automatically; after that, let the person choose rather than loop.
  let reloadedAt = 0
  window.webContents.on('render-process-gone', (_event, details) => {
    if (window.isDestroyed() || details.reason === 'clean-exit') return
    console.error(`Renderer process gone (${details.reason}, exit code ${details.exitCode})`)
    if (Date.now() - reloadedAt > 60_000) {
      reloadedAt = Date.now()
      window.webContents.reload()
      return
    }
    void dialog
      .showMessageBox(window, {
        type: 'error',
        title: appName,
        message: 'The Dovo Studio window stopped unexpectedly.',
        detail: `Reason: ${details.reason}. Your tasks keep running on the runtime; reopening the window restores them.`,
        buttons: ['Reload', 'Quit'],
        defaultId: 0,
        cancelId: 0,
      })
      .then(({ response }) => {
        if (window.isDestroyed()) return
        if (response === 0) window.webContents.reload()
        else app.quit()
      })
  })
  window.webContents.on('unresponsive', () => {
    if (window.isDestroyed()) return
    void dialog
      .showMessageBox(window, {
        type: 'warning',
        title: appName,
        message: 'The Dovo Studio window is not responding.',
        detail:
          'Wait for it to recover, or reload the window. Your tasks keep running on the runtime.',
        buttons: ['Wait', 'Reload'],
        defaultId: 0,
        cancelId: 0,
      })
      .then(({ response }) => {
        if (!window.isDestroyed() && response === 1) window.webContents.forcefullyCrashRenderer()
      })
  })

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

ipcMain.handle('links:choose', async (event, url: unknown) => {
  requireTrustedRenderer(event, rendererPath)
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || typeof url !== 'string') return false
  return offerLink(window, url, () => {})
})
ipcMain.handle('links:external', async (event, url: unknown) => {
  requireTrustedRenderer(event, rendererPath)
  if (typeof url !== 'string') throw new Error('Expected a link URL')
  await openExternalLink(url)
})

let activateSelectedRuntime = false
let switchingRuntime = false
ipcMain.handle('runtime:connection', async (event) => {
  requireTrustedRenderer(event, rendererPath)
  if (switchingRuntime) throw new Error('A runtime switch is already in progress')
  const connection = await startLocalRuntime(__dirname)
  if (!activateSelectedRuntime) return connection
  activateSelectedRuntime = false
  return { ...connection, activate: true }
})
ipcMain.handle('runtime:windows-connection', async (event) => {
  requireTrustedRenderer(event, rendererPath)
  if (process.platform !== 'win32')
    throw new Error('Windows runtime selection is only available on Windows')
  if (switchingRuntime) throw new Error('A runtime switch is already in progress')
  try {
    const connection = await startLocalRuntime(__dirname)
    await checkRuntimeConnection(connection)
    return connection
  } catch (cause) {
    throw windowsRuntimeFailure('Could not connect to the selected runtime', cause)
  }
})

ipcMain.handle('runtime:windows-read', (event) => {
  requireTrustedRenderer(event, rendererPath)
  if (process.platform !== 'win32')
    throw new Error('Windows runtime selection is only available on Windows')
  return windowsRuntimeStatus()
})
ipcMain.handle('runtime:windows-security', (event) => {
  requireTrustedRenderer(event, rendererPath)
  return readWindowsSecurity()
})
function windowsRuntimeFailure(stage: string, cause: unknown) {
  console.error(stage, cause)
  const message =
    cause instanceof AggregateError
      ? `${cause.message}: ${cause.errors.map(windowsRuntimeErrorMessage).join('; ')}`
      : windowsRuntimeErrorMessage(cause)
  const detail =
    cause instanceof AggregateError
      ? message
      : /fetch failed|ECONNREFUSED/.test(message)
        ? 'The local runtime is not accepting the connection. Retry; if it still fails, restart Dovo Studio and inspect the runtime log.'
        : cause instanceof Error && cause.name === 'TimeoutError'
          ? 'The local runtime did not respond within 10 seconds. Retry or restart Dovo Studio.'
          : message
  const restored =
    message.includes('The previous execution environment was restored.') &&
    !detail.includes('The previous execution environment was restored.')
      ? ' The previous execution environment was restored.'
      : ''
  return new Error(`${stage}. ${detail}${restored}`, { cause })
}
ipcMain.handle('runtime:windows-save', async (event, value: unknown) => {
  requireTrustedRenderer(event, rendererPath)
  if (process.platform !== 'win32')
    throw new Error('Windows runtime selection is only available on Windows')
  if (switchingRuntime) throw new Error('A runtime switch is already in progress')
  const choice = decode(windowsRuntimeChoiceSchema, value)
  switchingRuntime = true
  let stage = 'Could not prepare the selected execution environment'
  try {
    if (choice.mode === 'wsl') await prepareWslRuntime(choice.distribution)
    const previous = readWindowsRuntimeChoice()
    // Accepting the existing native environment is setup, not a runtime restart.
    if (choice.mode === 'native' && previous?.mode !== 'wsl') {
      stage = 'Could not connect to the Native Windows runtime'
      const connection = await startLocalRuntime(__dirname)
      await checkRuntimeConnection(connection)
      stage = 'Could not save the runtime selection'
      writeWindowsRuntimeChoice(choice)
      activateSelectedRuntime = true
      return connection
    }
    stage = 'Could not stop the current runtime for switching'
    await pauseLocalRuntime()
    stage =
      choice.mode === 'wsl'
        ? `Could not connect to WSL (${choice.distribution})`
        : 'Could not connect to the Native Windows runtime'
    try {
      writeWindowsRuntimeChoice(choice)
      const connection = await startLocalRuntime(__dirname)
      await checkRuntimeConnection(connection)
      activateSelectedRuntime = true
      return connection
    } catch (cause) {
      try {
        await pauseLocalRuntime()
        writeWindowsRuntimeChoice(previous)
        const recovered = await startLocalRuntime(__dirname)
        await checkRuntimeConnection(recovered)
      } catch (recovery) {
        throw new AggregateError([cause, recovery], 'Runtime switch and recovery failed')
      }
      throw new Error(
        `${windowsRuntimeErrorMessage(cause)} The previous execution environment was restored.`,
        { cause },
      )
    }
  } catch (cause) {
    throw windowsRuntimeFailure(stage, cause)
  } finally {
    switchingRuntime = false
  }
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
        if (process.platform === 'win32' && readWindowsRuntimeChoice()?.mode === 'wsl')
          throw new Error(
            'Use Browse to select a Linux folder inside the selected WSL distribution.',
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
    void registerRemoteUpdates(dataDirectory, updates, dataRoot)
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
    Effect.catch((error) =>
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
