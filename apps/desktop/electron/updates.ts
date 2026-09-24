import { decode } from '@dovo/protocol'
import { app, dialog, Menu, BrowserWindow, shell, type MenuItemConstructorOptions } from 'electron'
import updater from 'electron-updater'
import { snapshotSchema } from '@dovo/protocol'
import { startLocalRuntime } from './local-runtime.js'
const { autoUpdater } = updater
export function registerUpdates(
  directory: string,
  prepareQuit: () => Promise<() => Promise<void>>,
) {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false
  let busy = false
  let restoreRuntime: (() => Promise<void>) | undefined
  const recover = async () => {
    const restore = restoreRuntime
    restoreRuntime = undefined
    if (restore) await restore()
  }
  autoUpdater.on('error', (error) => {
    console.error('Desktop update failed:', error.message)
    void recover().catch((cause) =>
      console.error('Could not restore runtime after failed update:', cause),
    )
  })
  const check = async () => {
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
        await shell.openExternal('https://github.com/dovocode/dovo-studio/releases/latest')
      return
    }
    busy = true
    try {
      const result = await autoUpdater.checkForUpdates()
      if (!result?.isUpdateAvailable) {
        await dialog.showMessageBox({
          type: 'info',
          message: 'Dovo Studio is up to date.',
          detail: `Installed version: ${app.getVersion()}`,
        })
        return
      }
      const answer = await dialog.showMessageBox({
        type: 'info',
        message: `Dovo Studio ${result?.updateInfo.version ?? ''} is available`,
        detail:
          'Download the update now? Installation waits for your confirmation and keeps your projects, conversations and paired devices.',
        buttons: ['Download update', 'Later'],
        cancelId: 1,
        defaultId: 0,
      })
      if (answer.response !== 0) return
      for (const window of BrowserWindow.getAllWindows()) window.setProgressBar(0)
      const progress = (info: { percent: number }) => {
        for (const window of BrowserWindow.getAllWindows())
          window.setProgressBar(info.percent / 100)
      }
      autoUpdater.on('download-progress', progress)
      try {
        await autoUpdater.downloadUpdate()
      } finally {
        autoUpdater.removeListener('download-progress', progress)
        for (const window of BrowserWindow.getAllWindows()) window.setProgressBar(-1)
      }
      const install = await dialog.showMessageBox({
        type: 'info',
        message: 'Update ready',
        detail: 'Restart Dovo Studio to install. Active tasks and automations must finish first.',
        buttons: ['Restart and install', 'Later'],
        cancelId: 1,
        defaultId: 1,
      })
      if (install.response !== 0) return
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
        message: 'Could not update Dovo Studio',
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
            label: 'Dovo Studio',
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
  return check
}
