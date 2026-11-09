import { readLocalSettingsSection, writeLocalSettingsSection } from '@dovo/protocol/local-settings'
import { ManagedPolicy } from '@dovo/runtime/managed-policy'
import { decode, fetchRuntimeReleases, nativeAgentWorking } from '@dovo/protocol'
import { fetchGitHubRelease } from '@dovo/protocol/github-release-auth'
import { app, dialog, Menu, BrowserWindow, shell, type MenuItemConstructorOptions } from 'electron'
import updater from 'electron-updater'
import { snapshotSchema, type DesktopUpdateChannel, type DesktopUpdateState } from '@dovo/protocol'
import { startLocalRuntime } from './local-runtime.js'
const { autoUpdater } = updater
export function registerUpdates(
  directory: string,
  prepareQuit: (beforeStop: () => Promise<void>) => Promise<() => Promise<void>>,
) {
  const policy = ManagedPolicy.load()
  const managedUpdates = policy.document?.limits?.updates
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  const nightly = app.isPackaged && /-nightly\.\d+$/.test(app.getVersion())
  const appName = !app.isPackaged
    ? 'Dovo Studio (Dev)'
    : nightly
      ? 'Dovo Studio (Nightly)'
      : 'Dovo Studio'
  const savedChannel = readLocalSettingsSection('updates')
  let channel: DesktopUpdateChannel =
    managedUpdates?.allowNightly === false
      ? 'stable'
      : savedChannel === 'stable' || savedChannel === 'nightly'
        ? savedChannel
        : nightly
          ? 'nightly'
          : 'stable'
  const configureChannel = () => {
    const feed = channel === 'nightly' ? 'nightly' : 'latest'
    autoUpdater.channel =
      process.platform === 'win32' && process.arch === 'arm64' ? `${feed}-arm64` : feed
    autoUpdater.allowPrerelease = channel === 'nightly'
    autoUpdater.allowDowngrade = channel !== (nightly ? 'nightly' : 'stable')
  }
  configureChannel()
  autoUpdater.autoDownload = false
  let busy = false
  let state: DesktopUpdateState = { status: 'idle', channel }
  let checking: Promise<boolean> | undefined
  const publish = (next: DesktopUpdateState) => {
    state = { ...next, channel }
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
      const response = await fetchGitHubRelease(
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
    if (managedUpdates?.mode === 'off') return Promise.resolve(false)
    if (!app.isPackaged || (process.platform === 'linux' && !process.env.APPIMAGE))
      return Promise.resolve(false)
    if (state.status === 'downloading' || state.status === 'restarting')
      return Promise.resolve(true)
    if (checking) return checking
    checking = (async () => {
      if (managedUpdates?.feedUrl) {
        autoUpdater.setFeedURL({ provider: 'generic', url: managedUpdates.feedUrl })
        return autoUpdater.checkForUpdates()
      }
      // Resolve the chosen published channel for every check, with or without a GitHub login.
      // Keep tokens out of updater logs and downloads, and avoid GitHub's prerelease selector.
      const release = (await fetchRuntimeReleases(fetchGitHubRelease))[channel]
      if (!release) throw new Error(`No ${channel} desktop release is published`)
      autoUpdater.setFeedURL({
        provider: 'generic',
        url: `https://github.com/dovocode/dovo-studio/releases/download/v${release.version}/`,
      })
      return autoUpdater.checkForUpdates()
    })()
      .then((result) => {
        if (result?.isUpdateAvailable) {
          const notes = notesText(result.updateInfo.releaseNotes)
          const downloaded =
            state.status === 'downloaded' && state.version === result.updateInfo.version
          publish({
            status: downloaded ? 'downloaded' : 'available',
            version: result.updateInfo.version,
            ...(downloaded ? { progress: 100 } : {}),
            notes,
          })
          if (!notes && !managedUpdates?.feedUrl) void fetchReleaseNotes(result.updateInfo.version)
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
    publish({ ...state, status: 'error', error: error.message })
    void recover().catch((cause) =>
      console.error('Could not restore runtime after failed update:', cause),
    )
  })
  const check = async (
    direct = false,
    remote?: {
      action: 'download' | 'restart' | 'install'
      version: string
      resumeInterrupted?: boolean
    },
  ) => {
    policy.require('updates')
    if (remote?.version.includes('-nightly.')) policy.require('nightlyUpdates')
    if (busy) {
      if (remote) throw new Error('A desktop update is already running')
      return
    }
    if (remote && (!app.isPackaged || (process.platform === 'linux' && !process.env.APPIMAGE)))
      throw new Error('Update this desktop installation on its host')
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
          channel === 'nightly'
            ? 'https://github.com/dovocode/dovo-studio/releases?q=nightly'
            : 'https://github.com/dovocode/dovo-studio/releases/latest',
        )
      return
    }
    busy = true
    let resumeInterrupted = remote?.resumeInterrupted
    let restartPreparation: { address: string; token: string; id: string } | undefined
    try {
      if (
        remote?.action === 'restart' &&
        (state.status !== 'downloaded' || state.version !== remote.version)
      )
        throw new Error('Download this desktop update before restarting')
      if (
        remote?.action !== 'restart' &&
        (!direct || remote?.action === 'download' || state.status !== 'downloaded')
      ) {
        await refresh()
      }
      if (state.status !== 'available' && state.status !== 'downloaded') {
        if (remote) throw new Error('No desktop update is available. Check updates again.')
        await dialog.showMessageBox({
          type: 'info',
          message: `${appName} is up to date.`,
          detail: `Installed version: ${app.getVersion()}`,
        })
        return
      }
      if (remote && state.version !== remote.version)
        throw new Error('The available desktop release changed. Check updates again.')
      if (remote?.action === 'download' && state.status === 'downloaded') return
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
        publish({ ...state, status: 'downloading', progress: 0, error: undefined })
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
        if (remote && remote.action !== 'install') return
        if (!remote) {
          const answer = await dialog.showMessageBox({
            type: 'info',
            message: `${appName} ${state.version ?? ''} is ready`,
            detail:
              process.platform === 'win32'
                ? 'Dovo will close and open the Windows installer with installation progress. Follow the installer to finish and reopen Dovo. Your projects, conversations and paired devices are kept. Choose Later to keep working.'
                : 'The update is downloaded. Restart now to install it, or keep working and restart later.',
            buttons: ['Restart and install', 'Later'],
            cancelId: 1,
            defaultId: 1,
          })
          if (answer.response !== 0) return
        }
      }
      const connection = await startLocalRuntime(directory, { allowIncompatible: true })
      const response = await fetch(`${connection.address}/api/snapshot?scope=overview`, {
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
        resumeInterrupted === undefined &&
        (snapshot.workspace.tasks.some(
          (task) =>
            !task.replica &&
            (task.status === 'running' || task.subagents?.some(nativeAgentWorking)),
        ) ||
          snapshot.runs.some((run) => run.status === 'running'))
      ) {
        if (remote)
          throw new Error('Finish running tasks and automations before restarting this desktop')
        const answer = await dialog.showMessageBox({
          type: 'question',
          message: 'Restart with work in progress?',
          detail:
            'The update is ready. Restarting interrupts local tasks and automations. Dovo saves their progress and resumes supported tasks after restart. You can also keep working and install later.',
          buttons: ['Restart and resume', 'Later'],
          cancelId: 1,
          defaultId: 1,
        })
        if (answer.response !== 0) return
        resumeInterrupted = true
      }
      restoreRuntime = await prepareQuit(async () => {
        // Hold the runtime restart lease for local and remote installs. The earlier
        // snapshot alone cannot stop another device from starting work during shutdown.
        const prepared = await fetch(`${connection.address}/api/runtime/prepare-restart`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${connection.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ resumeInterrupted }),
          signal: AbortSignal.timeout(5000),
        })
        if (!prepared.ok) throw new Error('Could not prepare interrupted threads for restart')
        const result: unknown = await prepared.json()
        if (
          !result ||
          typeof result !== 'object' ||
          !('id' in result) ||
          typeof result.id !== 'string'
        )
          throw new Error('Invalid restart preparation')
        restartPreparation = { ...connection, id: result.id }
      })
      publish({ ...state, status: 'restarting' })
      // Show local Windows installation progress. Remote updates must finish unattended
      // so paired devices can reconnect without someone clicking Finish on this computer.
      autoUpdater.quitAndInstall(process.platform === 'win32' && remote !== undefined, true)
    } catch (error) {
      let message = error instanceof Error ? error.message : String(error)
      try {
        await recover()
      } catch (cause) {
        message += ` Runtime recovery failed: ${cause instanceof Error ? cause.message : String(cause)}`
      }
      try {
        if (restartPreparation) {
          const cancelled = await fetch(
            `${restartPreparation.address}/api/runtime/cancel-restart`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${restartPreparation.token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ id: restartPreparation.id }),
              signal: AbortSignal.timeout(5000),
            },
          )
          if (!cancelled.ok) throw new Error('Could not cancel restart preparation')
        }
      } catch (cause) {
        message += ` Restart cancellation failed: ${cause instanceof Error ? cause.message : String(cause)}`
      }
      publish({
        ...state,
        status: state.progress === 100 ? 'downloaded' : 'error',
        error: message,
      })
      if (remote) throw new Error(message)
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
    label:
      managedUpdates?.mode === 'off'
        ? `Updates managed by ${policy.document!.organization}`
        : 'Check for Updates…',
    enabled: managedUpdates?.mode !== 'off',
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
    setChannel: async (next: unknown) => {
      policy.require('updates')
      if (next === 'nightly') policy.require('nightlyUpdates')
      if (next !== 'stable' && next !== 'nightly') throw new Error('Invalid update channel')
      if (next === channel) return
      if (busy || checking || ['downloading', 'downloaded', 'restarting'].includes(state.status))
        throw new Error('Finish the current update before switching channels')
      writeLocalSettingsSection('updates', () => next)
      channel = next
      configureChannel()
      publish({ status: 'idle' })
      await refresh()
    },
    state: () => state,
    refresh,
    install: () => check(true),
    remote: (
      action: 'download' | 'restart' | 'install',
      version: string,
      resumeInterrupted?: boolean,
    ) => check(true, { action, version, resumeInterrupted }),
    installedVersion: app.getVersion(),
    supported:
      managedUpdates?.mode !== 'off' &&
      app.isPackaged &&
      (process.platform !== 'linux' || !!process.env.APPIMAGE),
  }
}
