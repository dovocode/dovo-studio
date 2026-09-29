import { decode } from '@dovo/protocol'
import { app, dialog, Menu, BrowserWindow, shell, type MenuItemConstructorOptions } from 'electron'
import updater from 'electron-updater'
import { snapshotSchema, type DesktopUpdateState } from '@dovo/protocol'
import { startLocalRuntime } from './local-runtime.js'
const { autoUpdater } = updater
export function registerUpdates(
  directory: string,
  prepareQuit: () => Promise<() => Promise<void>>,
) {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  const nightly = app.isPackaged && /-nightly\.\d+$/.test(app.getVersion())
  const appName = !app.isPackaged
    ? 'Dovo Studio (Dev)'
    : nightly
      ? 'Dovo Studio (Nightly)'
      : 'Dovo Studio'
  autoUpdater.allowPrerelease = nightly
  autoUpdater.autoDownload = false
  let busy = false
  let state: DesktopUpdateState = { status: 'idle' }
  let checking: Promise<boolean> | undefined
  const publish = (next: DesktopUpdateState) => {
    state = next
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send('updates:state', state)
  }
  const notesText = (notes: unknown): string | undefined => {
    const text =
      typeof notes === 'string'
        ? notes
        : Array.isArray(notes)
          ? notes.map((entry) => (typeof entry?.note === 'string' ? entry.note : '')).join('\n\n')
          : ''
    return text.trim() || undefined
  }
  const fetchReleaseNotes = async (version: string) => {
    try {
      const response = await fetch(
        `https://api.github.com/repos/dovocode/dovo-studio/releases/tags/v${encodeURIComponent(version)}`,
        {
          headers: { Accept: 'application/vnd.github+json' },
          signal: AbortSignal.timeout(10000),
        },
      )
      if (!response.ok) return
      const release: unknown = await response.json()
      const notes =
        release && typeof release === 'object' && 'body' in release
          ? notesText(release.body)
          : undefined
      if (notes && state.version === version && !state.notes) publish({ ...state, notes })
    } catch {
      // The update remains available when GitHub's release notes cannot be fetched.
    }
  }
  const refresh = () => {
    if (!app.isPackaged || (process.platform === 'linux' && !process.env.APPIMAGE))
      return Promise.resolve(false)
    if (state.status === 'downloading' || state.status === 'downloaded')
      return Promise.resolve(true)
    if (checking) return checking
    checking = autoUpdater
      .checkForUpdates()
      .then((result) => {
        if (result?.isUpdateAvailable) {
          const notes = notesText(result.updateInfo.releaseNotes)
          publish({
            status: 'available',
            version: result.updateInfo.version,
            notes,
          })
          if (!notes) void fetchReleaseNotes(result.updateInfo.version)
          return true
        }
        publish({ status: 'idle' })
        return false
      })
      .catch((error: unknown) => {
        if (state.status !== 'available' && state.status !== 'downloaded')
          publish({ status: 'error' })
        throw error
      })
      .finally(() => {
        checking = undefined
      })
    return checking
  }
  let restoreRuntime: (() => Promise<void>) | undefined
  const recover = async () => {
    const restore = restoreRuntime
    restoreRuntime = undefined
    if (restore) await restore()
  }
  autoUpdater.on('error', (error) => {
    console.error('Desktop update failed:', error.message)
    publish({ ...state, status: 'error' })
    void recover().catch((cause) =>
      console.error('Could not restore runtime after failed update:', cause),
    )
  })
  const check = async (direct = false) => {
    if (busy) return
    if (!app.isPackaged) {
      await dialog.showMessageBox({
        type: 'info',
        title: 'Development build',
        message:
          'Update this checkout with git pull --ff-only, then pnpm install --frozen-lockfile and pnpm build.',
        detail:
          'Signed desktop releases can check, download and install updates from the Dovo Studio menu.',
      })
      return
    }
    if (process.platform === 'linux' && !process.env.APPIMAGE) {
      const answer = await dialog.showMessageBox({
        type: 'info',
        message: 'Update your Linux package',
        detail:
          'Install the Debian/RPM package for your architecture over the existing app. Your workspace and pairing data are preserved.',
        buttons: ['Open releases', 'Cancel'],
        cancelId: 1,
      })
      if (answer.response === 0)
        await shell.openExternal(
          nightly
            ? 'https://github.com/dovocode/dovo-studio/releases?q=nightly'
            : 'https://github.com/dovocode/dovo-studio/releases/latest',
        )
      return
    }
    busy = true
    try {
      if (state.status !== 'available' && state.status !== 'downloaded' && !(await refresh())) {
        await dialog.showMessageBox({
          type: 'info',
          message: `${appName} is up to date.`,
          detail: `Installed version: ${app.getVersion()}`,
        })
        return
      }
      if (!direct) {
        const answer = await dialog.showMessageBox({
          type: 'info',
          message: `${appName} ${state.version ?? ''} is available`,
          detail:
            'Download now. You can decide when to restart after the download finishes. Your projects, conversations and paired devices are kept.',
          buttons: [state.status === 'downloaded' ? 'Restart and install' : 'Download', 'Later'],
          cancelId: 1,
          defaultId: 0,
        })
        if (answer.response !== 0) return
      }
      if (state.status !== 'downloaded') {
        for (const window of BrowserWindow.getAllWindows()) window.setProgressBar(0)
        let lastProgress = 0
        const progress = (info: {
          percent: number
          transferred: number
          total: number
          bytesPerSecond: number
        }) => {
          if (info.percent < 100 && Date.now() - lastProgress < 200) return
          lastProgress = Date.now()
          publish({
            ...state,
            status: 'downloading',
            progress: info.percent,
            transferred: info.transferred,
            total: info.total,
            bytesPerSecond: info.bytesPerSecond,
          })
          for (const window of BrowserWindow.getAllWindows())
            window.setProgressBar(info.percent / 100)
        }
        autoUpdater.on('download-progress', progress)
        try {
          await autoUpdater.downloadUpdate()
          publish({ ...state, status: 'downloaded', progress: 100 })
        } finally {
          autoUpdater.removeListener('download-progress', progress)
          for (const window of BrowserWindow.getAllWindows()) window.setProgressBar(-1)
        }
        const answer = await dialog.showMessageBox({
          type: 'info',
          message: `${appName} ${state.version ?? ''} is ready`,
          detail:
            'The update is downloaded. Restart now to install it, or keep working and restart later.',
          buttons: ['Restart and install', 'Later'],
          cancelId: 1,
          defaultId: 1,
        })
        if (answer.response !== 0) return
      }
      const connection = await startLocalRuntime(directory, { allowIncompatible: true })
      const response = await fetch(`${connection.address}/api/snapshot`, {
        headers: {
          Authorization: `Bearer ${connection.token}`,
        },
        signal: AbortSignal.timeout(5000),
      })
      if (!response.ok)
        throw new Error(
          'Could not verify active work. Reconnect the local runtime before installing.',
        )
      const snapshot = decode(snapshotSchema, await response.json())
      if (
        snapshot.workspace.tasks.some((task) => task.status === 'running') ||
        snapshot.runs.some((run) => run.status === 'running')
      ) {
        await dialog.showMessageBox({
          type: 'info',
          message: 'Finish running work first',
          detail:
            'Your update is downloaded. Use Check for Updates again after local tasks and automations finish.',
        })
        return
      }
      publish({ ...state, status: 'restarting' })
      restoreRuntime = await prepareQuit()
      autoUpdater.quitAndInstall(false, true)
    } catch (error) {
      let message = error instanceof Error ? error.message : String(error)
      try {
        await recover()
      } catch (cause) {
        message += ` Runtime recovery failed: ${cause instanceof Error ? cause.message : String(cause)}`
      }
      await dialog.showMessageBox({
        type: 'error',
        message: `Could not update ${appName}`,
        detail: message,
      })
    } finally {
      busy = false
    }
  }
  const updateItem: MenuItemConstructorOptions = {
    label: 'Check for Updates…',
    click: () => {
      void check()
    },
  }
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: appName,
            submenu: [
              {
                role: 'about' as const,
              },
              updateItem,
              {
                type: 'separator' as const,
              },
              {
                role: 'services' as const,
              },
              {
                role: 'hide' as const,
              },
              {
                role: 'hideOthers' as const,
              },
              {
                type: 'separator' as const,
              },
              {
                role: 'quit' as const,
              },
            ],
          },
        ]
      : []),
    {
      role: 'fileMenu',
    },
    {
      role: 'editMenu',
    },
    {
      role: 'viewMenu',
    },
    {
      role: 'windowMenu',
    },
    {
      role: 'help',
      submenu: [updateItem],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  return {
    check,
    state: () => state,
    refresh,
    install: () => check(true),
  }
}
