import { readLocalSettingsSection, writeLocalSettingsSection } from '@dovo/protocol/local-settings'
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
const f = vi.hoisted(() => ({
  token: vi.fn<() => Promise<string | undefined>>(async () => undefined),
  githubFetch: vi.fn<typeof fetch>(async (input, init) => fetch(input, init)),
  open: vi.fn<(url: string) => Promise<void>>(async (_url) => {}),
  listeners: new Map<
    string,
    (
      event:
        | Error
        | { percent: number; transferred: number; total: number; bytesPerSecond: number },
    ) => void
  >(),
  install: vi.fn<() => void>(),
  feed: vi.fn<(options: unknown) => void>(),
  message: vi.fn<(options: unknown) => Promise<{ response: number }>>(async () => ({
    response: 0,
  })),
  next: 'next',
  checks: vi.fn<() => void>(),
  downloads: vi.fn<(version: string) => void>(),
  version: 'fixture',
  notes: 'Faster setup and fixes' as string | undefined,
  menu: undefined as unknown,
  states: [] as unknown[],
}))
vi.mock('@dovo/protocol/github-release-auth', () => ({
  githubReleaseToken: f.token,
  fetchGitHubRelease: f.githubFetch,
}))
vi.mock('@dovo/protocol/local-settings', () => ({
  readLocalSettingsSection: vi.fn<typeof readLocalSettingsSection>(() => undefined),
  writeLocalSettingsSection: vi.fn<typeof writeLocalSettingsSection>(),
}))
vi.mock('electron', () => ({
  app: { isPackaged: true, getVersion: () => f.version },
  dialog: { showMessageBox: f.message },
  shell: { openExternal: f.open },
  Menu: {
    buildFromTemplate: (value: unknown) => value,
    setApplicationMenu: (value: unknown) => {
      f.menu = value
    },
  },
  BrowserWindow: {
    getAllWindows: () => [
      {
        webContents: { send: (_channel: string, state: unknown) => f.states.push(state) },
        setProgressBar: () => {},
      },
    ],
  },
}))
vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: {
      on: (
        name: string,
        listener: (
          event:
            | Error
            | { percent: number; transferred: number; total: number; bytesPerSecond: number },
        ) => void,
      ) => {
        f.listeners.set(name, listener)
      },
      removeListener: () => {},
      checkForUpdates: async () => {
        f.checks()
        return { isUpdateAvailable: true, updateInfo: { version: f.next, releaseNotes: f.notes } }
      },
      downloadUpdate: async () => {
        f.downloads(f.next)
        f.listeners.get('download-progress')?.({
          percent: 50,
          transferred: 5_000_000,
          total: 10_000_000,
          bytesPerSecond: 1_000_000,
        })
      },
      setFeedURL: f.feed,
      quitAndInstall: f.install,
    },
  },
}))
vi.mock('./local-runtime.js', () => ({
  startLocalRuntime: async () => ({ address: 'http://fixture', token: 'fixture-token' }),
}))
beforeEach(() => {
  // Generic updater tests describe an auto-updatable installation on every host.
  // The package-manager cases below explicitly clear APPIMAGE.
  vi.stubEnv('APPIMAGE', '/fixture/Dovo.AppImage')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  f.token.mockResolvedValue(undefined)
  vi.mocked(readLocalSettingsSection).mockReturnValue(undefined)
  f.listeners.clear()
  f.next = 'next'
  f.version = 'fixture'
  f.notes = 'Faster setup and fixes'
  f.menu = undefined
  f.states = []
})
const snapshot = {
  revision: 0,
  owner: true,
  approvals: [],
  terminals: [],
  runs: [],
  devices: [],
  pendingDevices: [],
  workspace: {
    version: 1,
    runtimeAddress: '',
    agents: [],
    repositories: [],
    tasks: [],
    automations: [],
  },
}
it('publishes update notes and downloads directly from the sidebar action', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () => Response.json(snapshot)),
  )
  const { registerUpdates } = await import('./updates')
  const updates = registerUpdates('/unused', async () => async () => {})
  await updates.refresh()
  expect(updates.state()).toMatchObject({
    status: 'available',
    version: 'next',
    notes: 'Faster setup and fixes',
  })
  await updates.install()
  expect(updates.state()).toMatchObject({ status: 'restarting', progress: 100 })
  expect(f.states).toContainEqual(
    expect.objectContaining({
      status: 'downloading',
      progress: 50,
      transferred: 5_000_000,
      total: 10_000_000,
    }),
  )
  expect(f.message).toHaveBeenCalledOnce()
  expect(f.message).toHaveBeenCalledWith(
    expect.objectContaining({ buttons: ['Restart and install', 'Later'] }),
  )
  expect(f.install).toHaveBeenCalledOnce()
})
it('loads release notes from the release when updater metadata omits them', async () => {
  f.notes = undefined
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () => Response.json({ body: 'New release changes' })),
  )
  const { registerUpdates } = await import('./updates')
  const updates = registerUpdates('/unused', async () => async () => {})
  await updates.refresh()
  await vi.waitFor(() => expect(updates.state().notes).toBe('New release changes'))
  expect(f.githubFetch).toHaveBeenCalledOnce()
})

it('uses authenticated release discovery without sending a token to updater downloads', async () => {
  f.token.mockResolvedValue('gh_fixture')
  const metadata = {
    tag_name: 'v0.0.9',
    html_url: 'https://github.com/dovocode/dovo-studio/releases/tag/v0.0.9',
  }
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      return Response.json(url.endsWith('/latest') ? metadata : [metadata])
    }),
  )
  const { registerUpdates } = await import('./updates')
  const updates = registerUpdates('/unused', async () => async () => {})
  await updates.refresh()
  expect(f.githubFetch).toHaveBeenCalledTimes(2)
  expect(f.feed).toHaveBeenLastCalledWith({
    provider: 'generic',
    url: 'https://github.com/dovocode/dovo-studio/releases/download/v0.0.9/',
  })
  // Continue resolving each new version after the CLI login has been removed.
  f.token.mockResolvedValue(undefined)
  await updates.refresh()
  expect(f.githubFetch).toHaveBeenCalledTimes(4)
})
it('asks again after the download before restarting', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () => Response.json(snapshot)),
  )
  const { registerUpdates } = await import('./updates')
  await registerUpdates('/unused', async () => async () => {}).check()
  expect(f.message).toHaveBeenCalledTimes(2)
  expect(f.install).toHaveBeenCalledOnce()
})
it('keeps the downloaded update ready when restart is deferred', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () => Response.json(snapshot)),
  )
  f.message.mockResolvedValueOnce({ response: 1 })
  const { registerUpdates } = await import('./updates')
  const prepare = vi.fn<() => Promise<() => Promise<void>>>()
  const updates = registerUpdates('/unused', prepare)
  await updates.install()
  expect(updates.state().status).toBe('downloaded')
  expect(prepare).not.toHaveBeenCalled()
  expect(f.install).not.toHaveBeenCalled()
})
it('uses the same check action from the application menu and sidebar bridge', async () => {
  const { registerUpdates } = await import('./updates')
  const updates = registerUpdates('/unused', async () => async () => {})
  const menu = f.menu as Array<{
    role?: string
    submenu?: Array<{ label?: string; click?: () => void }>
  }>
  const menuCheck = menu
    .find((item) => item.role === 'help')
    ?.submenu?.find((item) => item.label?.startsWith('Check for Updates'))
  expect(menuCheck?.click).toBeTypeOf('function')
  f.message.mockResolvedValueOnce({ response: 1 }).mockResolvedValueOnce({ response: 1 })
  menuCheck?.click?.()
  await vi.waitFor(() => expect(f.message).toHaveBeenCalledOnce())
  await updates.check()
  expect(f.message).toHaveBeenCalledTimes(2)
})
it('waits for the runtime to stop before installation and restores it on synchronous failure', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () => Response.json(snapshot)),
  )
  const { registerUpdates } = await import('./updates')
  const restore = vi.fn<() => Promise<void>>(async () => {})
  let stopped = false
  const prepare = vi.fn<() => Promise<() => Promise<void>>>(async () => {
    stopped = true
    return restore
  })
  f.install.mockImplementation(() => {
    expect(stopped).toBe(true)
    throw new Error('Install failed')
  })
  await registerUpdates('/unused', prepare).check()
  expect(prepare).toHaveBeenCalledOnce()
  expect(restore).toHaveBeenCalledOnce()
  expect(f.message).toHaveBeenLastCalledWith(expect.objectContaining({ detail: 'Install failed' }))
})
it('restores the stopped runtime when the updater reports an asynchronous installation error', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () => Response.json(snapshot)),
  )
  const { registerUpdates } = await import('./updates')
  const restore = vi.fn<() => Promise<void>>(async () => {})
  f.install.mockImplementation(() => {})
  await registerUpdates('/unused', async () => restore).check()
  f.listeners.get('error')?.(new Error('Installer rejected update'))
  await vi.waitFor(() => expect(restore).toHaveBeenCalledOnce())
  f.listeners.get('error')?.(new Error('Repeated error'))
  expect(restore).toHaveBeenCalledOnce()
})

it('opens Linux package downloads without attempting an AppImage update for DEB/RPM installs', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
  vi.stubEnv('APPIMAGE', '')
  const { registerUpdates } = await import('./updates')
  const prepare = vi.fn<() => Promise<() => Promise<void>>>(async () => async () => {})
  await registerUpdates('/unused', prepare).check()
  expect(f.open).toHaveBeenCalledWith('https://github.com/dovocode/dovo-studio/releases/latest')
  expect(prepare).not.toHaveBeenCalled()
  expect(f.install).not.toHaveBeenCalled()
})

it('keeps nightly updates on the prerelease channel and links nightly packages', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
  vi.stubEnv('APPIMAGE', '')
  f.version = '0.0.7-nightly.42'
  const { registerUpdates } = await import('./updates')
  const updater = (await import('electron-updater')).default.autoUpdater
  await registerUpdates('/unused', async () => async () => {}).check()
  expect(updater.allowPrerelease).toBe(true)
  expect(f.open).toHaveBeenCalledWith('https://github.com/dovocode/dovo-studio/releases?q=nightly')
})

it('downloads remotely without a host dialog and restarts only after an explicit command', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () => Response.json(snapshot)),
  )
  const { registerUpdates } = await import('./updates')
  const prepare = vi.fn<() => Promise<() => Promise<void>>>(async () => async () => {})
  const updates = registerUpdates('/unused', prepare)
  await updates.remote('download', 'next')
  expect(updates.state().status).toBe('downloaded')
  expect(f.message).not.toHaveBeenCalled()
  expect(f.install).not.toHaveBeenCalled()
  expect(prepare).not.toHaveBeenCalled()
  await updates.remote('restart', 'next')
  expect(prepare).toHaveBeenCalledOnce()
  expect(f.install).toHaveBeenCalledOnce()
})
it('refuses a remote restart without the requested download and reports active work', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () =>
      Response.json({
        ...snapshot,
        runs: [
          {
            id: 'run',
            automationId: 'automation',
            title: 'Running',
            status: 'running',
            agentId: 'agent',
            createdAt: '',
            messages: [],
            completedNodes: [],
            taskIds: [],
          },
        ],
      }),
    ),
  )
  const { registerUpdates } = await import('./updates')
  const updates = registerUpdates('/unused', async () => async () => {})
  await expect(updates.remote('restart', 'next')).rejects.toThrow('Download')
  await updates.remote('download', 'next')
  await expect(updates.remote('restart', 'next')).rejects.toThrow('Finish running')
  expect(f.install).not.toHaveBeenCalled()
  expect(f.message).not.toHaveBeenCalled()
})

it('persists a selected channel and clears release metadata from the previous channel', async () => {
  const { registerUpdates } = await import('./updates')
  const updater = (await import('electron-updater')).default.autoUpdater
  const updates = registerUpdates('/unused', async () => async () => {})
  await updates.refresh()
  await updates.setChannel('nightly')
  expect(updater.channel).toBe(
    process.platform === 'win32' && process.arch === 'arm64' ? 'nightly-arm64' : 'nightly',
  )
  expect(updater.allowPrerelease).toBe(true)
  expect(updates.state().channel).toBe('nightly')
  expect(writeLocalSettingsSection).toHaveBeenCalledWith('updates', expect.any(Function))
  expect(f.states).toContainEqual({ status: 'idle', channel: 'nightly' })
  await expect(updates.setChannel('invalid')).rejects.toThrow('Invalid update channel')
})

it('restores the saved channel instead of following the installed build', async () => {
  vi.mocked(readLocalSettingsSection).mockReturnValue('stable')
  f.version = '0.0.7-nightly.42'
  const { registerUpdates } = await import('./updates')
  const updater = (await import('electron-updater')).default.autoUpdater
  const updates = registerUpdates('/unused', async () => async () => {})
  expect(updates.state().channel).toBe('stable')
  expect(updater.allowPrerelease).toBe(false)
  expect(updater.allowDowngrade).toBe(true)
})

it('keeps a downloaded update on its selected channel until installation', async () => {
  f.message.mockResolvedValueOnce({ response: 1 })
  const { registerUpdates } = await import('./updates')
  const updates = registerUpdates('/unused', async () => async () => {})
  await updates.install()
  await expect(updates.setChannel('nightly')).rejects.toThrow('Finish the current update')
  expect(updates.state().channel).toBe('stable')
  expect(writeLocalSettingsSection).not.toHaveBeenCalled()
})

it('uses the architecture-specific feed when checking Windows ARM nightly releases', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  vi.spyOn(process, 'arch', 'get').mockReturnValue('arm64')
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) =>
      (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).endsWith(
        '/latest',
      )
        ? new Response(null, { status: 404 })
        : Response.json([
            {
              tag_name: 'v0.0.7-nightly.43',
              html_url: 'https://github.com/dovocode/dovo-studio/releases/tag/v0.0.7-nightly.43',
            },
          ]),
    ),
  )
  const { registerUpdates } = await import('./updates')
  const updater = (await import('electron-updater')).default.autoUpdater
  await registerUpdates('/unused', async () => async () => {}).setChannel('nightly')
  expect(updater.channel).toBe('nightly-arm64')
  expect(f.feed).toHaveBeenCalledWith({
    provider: 'generic',
    url: 'https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.43/',
  })
})

it('rechecks an existing offer before downloading the newest release', async () => {
  const { registerUpdates } = await import('./updates')
  const updates = registerUpdates('/unused', async () => async () => {})
  await updates.refresh()
  f.next = 'newer'
  f.message.mockResolvedValueOnce({ response: 1 })
  await updates.install()
  expect(f.checks).toHaveBeenCalledTimes(2)
  expect(f.downloads).toHaveBeenCalledWith('newer')
  expect(updates.state()).toMatchObject({ status: 'downloaded', version: 'newer' })
})
it('checks online even with a downloaded release, preserving it only while still current', async () => {
  const { registerUpdates } = await import('./updates')
  const updates = registerUpdates('/unused', async () => async () => {})
  f.message.mockResolvedValueOnce({ response: 1 })
  await updates.install()
  await updates.refresh()
  expect(updates.state().status).toBe('downloaded')
  f.next = 'newer'
  await updates.refresh()
  expect(updates.state()).toMatchObject({ status: 'available', version: 'newer' })
  expect(f.checks).toHaveBeenCalledTimes(3)
})

it('does not download a stale offer when the online recheck fails', async () => {
  const { registerUpdates } = await import('./updates')
  const updates = registerUpdates('/unused', async () => async () => {})
  await updates.refresh()
  f.checks.mockImplementationOnce(() => {
    throw new Error('Offline')
  })
  await updates.install()
  expect(f.downloads).not.toHaveBeenCalled()
  expect(f.message).toHaveBeenLastCalledWith(expect.objectContaining({ detail: 'Offline' }))
})

it('keeps default stable and nightly channels without saving an implicit choice', async () => {
  const { registerUpdates } = await import('./updates')
  const updater = (await import('electron-updater')).default.autoUpdater
  f.version = '0.0.7'
  expect(registerUpdates('/unused', async () => async () => {}).state().channel).toBe('stable')
  expect(updater.allowDowngrade).toBe(false)
  f.version = '0.0.7-nightly.42'
  expect(registerUpdates('/unused', async () => async () => {}).state().channel).toBe('nightly')
  expect(updater.allowPrerelease).toBe(true)
  expect(updater.allowDowngrade).toBe(false)
  expect(writeLocalSettingsSection).not.toHaveBeenCalled()
})
it('allows an explicit stable-to-nightly change despite prerelease version ordering', async () => {
  f.version = '0.0.7'
  const { registerUpdates } = await import('./updates')
  const updater = (await import('electron-updater')).default.autoUpdater
  const updates = registerUpdates('/unused', async () => async () => {})
  await updates.setChannel('nightly')
  expect(updater.allowPrerelease).toBe(true)
  expect(updater.allowDowngrade).toBe(true)
  expect(writeLocalSettingsSection).toHaveBeenCalledOnce()
})
