import { readLocalSettingsSection, writeLocalSettingsSection } from '@dovo/protocol/local-settings'
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { ManagedPolicy } from '@dovo/runtime/managed-policy'
import { decode, managedPolicySchema } from '@dovo/protocol'
const requestUrl = (input: Parameters<typeof fetch>[0]) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

const f = vi.hoisted(() => ({
  publicReleaseFetch: vi.fn<typeof fetch>(),
  githubFetch: vi.fn<typeof fetch>(),
  open: vi.fn<(url: string) => Promise<void>>(async (_url) => {}),
  listeners: new Map<
    string,
    (
      event:
        | Error
        | { percent: number; transferred: number; total: number; bytesPerSecond: number },
    ) => void
  >(),
  install: vi.fn<(silent: boolean, forceRunAfter: boolean) => void>(),
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
// Route only public discovery to its fixture. Runtime/release-note boundaries stay explicit.
function stubRuntimeFetch(fetcher: typeof fetch) {
  vi.stubGlobal('fetch', (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    requestUrl(input).startsWith('https://api.github.com/repos/dovocode/dovo-studio/releases') &&
    !requestUrl(input).includes('/releases/tags/')
      ? f.publicReleaseFetch(input, init)
      : fetcher(input, init),
  )
}
beforeEach(() => {
  f.githubFetch.mockImplementation((input, init) => fetch(input, init))
  stubRuntimeFetch(async (input) => {
    throw new Error(`Unexpected runtime request: ${requestUrl(input)}`)
  })
  // Generic updater tests describe an auto-updatable installation on every host.
  // The package-manager cases below explicitly clear APPIMAGE.
  vi.stubEnv('APPIMAGE', '/fixture/Dovo.AppImage')
  f.publicReleaseFetch.mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const release = (version: string) => ({
      tag_name: `v${version}`,
      html_url: `https://github.com/dovocode/dovo-studio/releases/tag/v${version}`,
      draft: false,
    })
    return Response.json(
      url.endsWith('/latest') ? release('0.0.9') : [release('0.0.9'), release('0.0.9-nightly.43')],
    )
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.clearAllMocks()
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
it('disables all update entry points under managed policy', async () => {
  vi.spyOn(ManagedPolicy, 'load').mockReturnValue(
    new ManagedPolicy(
      decode(managedPolicySchema, {
        schemaVersion: 1,
        organization: 'Example',
        limits: { updates: { mode: 'off' } },
      }),
    ),
  )
  const { registerUpdates } = await import('./updates')
  const updates = registerUpdates('/unused', async (beforeStop) => {
    await beforeStop()
    return async () => {}
  })
  expect(updates.supported).toBe(false)
  expect(await updates.refresh()).toBe(false)
  await expect(updates.install()).rejects.toThrow('Example')
  await expect(updates.remote('download', '1.0.0')).rejects.toThrow('Example')
  await expect(updates.setChannel('nightly')).rejects.toThrow('Example')
  expect(f.checks).not.toHaveBeenCalled()
  expect(f.downloads).not.toHaveBeenCalled()
})
it('forces stable updates and honors a managed HTTP desktop feed', async () => {
  vi.mocked(readLocalSettingsSection).mockReturnValue('nightly')
  vi.spyOn(ManagedPolicy, 'load').mockReturnValue(
    new ManagedPolicy(
      decode(managedPolicySchema, {
        schemaVersion: 1,
        organization: 'Example',
        limits: {
          updates: {
            mode: 'auto',
            allowNightly: false,
            feedUrl: 'http://updates.internal/releases/',
          },
        },
      }),
    ),
  )
  f.notes = undefined
  const { registerUpdates } = await import('./updates')
  const updates = registerUpdates('/unused', async (beforeStop) => {
    await beforeStop()
    return async () => {}
  })
  expect(updates.state().channel).toBe('stable')
  await expect(updates.setChannel('nightly')).rejects.toThrow('Example')
  await expect(updates.remote('download', '1.0.0-nightly.1')).rejects.toThrow('Example')
  await updates.refresh()
  expect(f.feed).toHaveBeenCalledWith({
    provider: 'generic',
    url: 'http://updates.internal/releases/',
  })
  expect(f.publicReleaseFetch).not.toHaveBeenCalled()
})
it('publishes update notes and downloads directly from the sidebar action', async () => {
  stubRuntimeFetch(
    vi.fn<typeof fetch>(async (input) =>
      Response.json(
        requestUrl(input).endsWith('/prepare-restart') ? { id: 'restart-lease' } : snapshot,
      ),
    ),
  )
  const { registerUpdates } = await import('./updates')
  const updates = registerUpdates('/unused', async (beforeStop) => {
    await beforeStop()
    return async () => {}
  })
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
  stubRuntimeFetch(vi.fn<typeof fetch>(async () => Response.json({ body: 'New release changes' })))
  const { registerUpdates } = await import('./updates')
  const updates = registerUpdates('/unused', async (beforeStop) => {
    await beforeStop()
    return async () => {}
  })
  await updates.refresh()
  await vi.waitFor(() => expect(updates.state().notes).toBe('New release changes'))
  expect(f.publicReleaseFetch).toHaveBeenCalledTimes(2)
  expect(f.githubFetch).toHaveBeenCalledOnce()
})

it('resolves the published release on every check without adding credentials to the download feed', async () => {
  const metadata = {
    tag_name: 'v0.0.9',
    html_url: 'https://github.com/dovocode/dovo-studio/releases/tag/v0.0.9',
  }
  f.publicReleaseFetch.mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    return Response.json(url.endsWith('/latest') ? metadata : [metadata])
  })
  const { registerUpdates } = await import('./updates')
  const updates = registerUpdates('/unused', async (beforeStop) => {
    await beforeStop()
    return async () => {}
  })
  await updates.refresh()
  expect(f.publicReleaseFetch).toHaveBeenCalledTimes(2)
  expect(f.githubFetch).not.toHaveBeenCalled()
  for (const [, options] of f.publicReleaseFetch.mock.calls) {
    expect(options?.credentials).toBe('omit')
    expect(new Headers(options?.headers).has('Authorization')).toBe(false)
  }
  expect(f.feed).toHaveBeenLastCalledWith({
    provider: 'generic',
    url: 'https://github.com/dovocode/dovo-studio/releases/download/v0.0.9/',
  })
  await updates.refresh()
  expect(f.publicReleaseFetch).toHaveBeenCalledTimes(4)
})
it.each(['stable', 'nightly'] as const)(
  'uses only published %s releases and follows channel changes on the next check',
  async (channel) => {
    const other = channel === 'stable' ? 'nightly' : 'stable'
    vi.mocked(readLocalSettingsSection).mockReturnValue(channel)
    f.version = other === 'nightly' ? '0.0.8-nightly.1' : '0.0.8'
    const release = (version: string, draft = false, prerelease = false) => ({
      tag_name: `v${version}`,
      html_url: `https://github.com/dovocode/dovo-studio/releases/tag/v${version}`,
      draft,
      prerelease,
    })
    f.publicReleaseFetch.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      return Response.json(
        url.endsWith('/latest')
          ? release('0.0.8')
          : [
              release('9.0.0', true),
              release('9.0.0-nightly.999', true, true),
              release('8.0.0', false, true),
              release('0.0.9'),
              release('0.0.9-nightly.43', false, true),
            ],
      )
    })
    const versions = { stable: '0.0.9', nightly: '0.0.9-nightly.43' }
    const { registerUpdates } = await import('./updates')
    const updates = registerUpdates('/unused', async (beforeStop) => {
      await beforeStop()
      return async () => {}
    })
    await updates.refresh()
    expect(f.feed).toHaveBeenLastCalledWith({
      provider: 'generic',
      url: `https://github.com/dovocode/dovo-studio/releases/download/v${versions[channel]}/`,
    })
    await updates.setChannel(other)
    expect(f.feed).toHaveBeenLastCalledWith({
      provider: 'generic',
      url: `https://github.com/dovocode/dovo-studio/releases/download/v${versions[other]}/`,
    })
    expect(updates.state().channel).toBe(other)
    expect(f.publicReleaseFetch).toHaveBeenCalledTimes(4)
  },
)
it('reports a missing published channel instead of checking another channel', async () => {
  vi.mocked(readLocalSettingsSection).mockReturnValue('nightly')
  f.publicReleaseFetch.mockImplementation(async () => Response.json([]))
  const { registerUpdates } = await import('./updates')
  const updates = registerUpdates('/unused', async (beforeStop) => {
    await beforeStop()
    return async () => {}
  })
  await expect(updates.refresh()).rejects.toThrow(
    'No published nightly desktop update was found. Try again later or check the releases page.',
  )
  expect(updates.state()).toEqual({ status: 'error', channel: 'nightly' })
  expect(f.checks).not.toHaveBeenCalled()
  expect(f.feed).not.toHaveBeenCalled()
})
it('asks again after the download before restarting', async () => {
  stubRuntimeFetch(
    vi.fn<typeof fetch>(async (input) =>
      Response.json(
        requestUrl(input).endsWith('/prepare-restart') ? { id: 'restart-lease' } : snapshot,
      ),
    ),
  )
  const { registerUpdates } = await import('./updates')
  await registerUpdates('/unused', async (beforeStop) => {
    await beforeStop()
    return async () => {}
  }).check()
  expect(f.message).toHaveBeenCalledTimes(2)
  expect(f.install).toHaveBeenCalledOnce()
})
it('keeps the downloaded update ready when restart is deferred', async () => {
  stubRuntimeFetch(
    vi.fn<typeof fetch>(async (input) =>
      Response.json(
        requestUrl(input).endsWith('/prepare-restart') ? { id: 'restart-lease' } : snapshot,
      ),
    ),
  )
  f.message.mockResolvedValueOnce({ response: 1 })
  const { registerUpdates } = await import('./updates')
  const prepare = vi.fn<(beforeStop: () => Promise<void>) => Promise<() => Promise<void>>>()
  const updates = registerUpdates('/unused', prepare)
  await updates.install()
  expect(updates.state().status).toBe('downloaded')
  expect(prepare).not.toHaveBeenCalled()
  expect(f.install).not.toHaveBeenCalled()
})
it('shows Windows installation progress only after restart is confirmed', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  vi.spyOn(process, 'arch', 'get').mockReturnValue('x64')
  stubRuntimeFetch(
    vi.fn<typeof fetch>(async (input) =>
      Response.json(
        requestUrl(input).endsWith('/prepare-restart') ? { id: 'restart-lease' } : snapshot,
      ),
    ),
  )
  f.message.mockResolvedValueOnce({ response: 0 }).mockResolvedValueOnce({ response: 1 })
  const { registerUpdates } = await import('./updates')
  const updater = (await import('electron-updater')).default.autoUpdater
  const prepare = vi.fn<(beforeStop: () => Promise<void>) => Promise<() => Promise<void>>>(
    async (beforeStop) => {
      await beforeStop()
      return async () => {}
    },
  )
  const updates = registerUpdates('/unused', prepare)
  await updates.check()
  expect(updates.state().status).toBe('downloaded')
  expect(f.message).toHaveBeenLastCalledWith(
    expect.objectContaining({
      buttons: ['Restart and install', 'Later'],
      detail: expect.stringContaining('Dovo will close and open the Windows installer'),
    }),
  )
  expect(prepare).not.toHaveBeenCalled()
  expect(f.install).not.toHaveBeenCalled()
  expect(updater.autoInstallOnAppQuit).toBe(false)
  // Clicking the downloaded update's restart action is explicit confirmation.
  await updates.install()
  expect(prepare).toHaveBeenCalledOnce()
  expect(f.install).toHaveBeenCalledExactlyOnceWith(false, true)
  expect(updates.state().status).toBe('restarting')
})
it('uses the same check action from the application menu and sidebar bridge', async () => {
  const { registerUpdates } = await import('./updates')
  const updates = registerUpdates('/unused', async (beforeStop) => {
    await beforeStop()
    return async () => {}
  })
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
  stubRuntimeFetch(
    vi.fn<typeof fetch>(async (input) =>
      Response.json(
        requestUrl(input).endsWith('/prepare-restart') ? { id: 'restart-lease' } : snapshot,
      ),
    ),
  )
  const { registerUpdates } = await import('./updates')
  const restore = vi.fn<() => Promise<void>>(async () => {})
  let stopped = false
  const prepare = vi.fn<(beforeStop: () => Promise<void>) => Promise<() => Promise<void>>>(
    async (beforeStop) => {
      await beforeStop()
      stopped = true
      return restore
    },
  )
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
  stubRuntimeFetch(
    vi.fn<typeof fetch>(async (input) =>
      Response.json(
        requestUrl(input).endsWith('/prepare-restart') ? { id: 'restart-lease' } : snapshot,
      ),
    ),
  )
  const { registerUpdates } = await import('./updates')
  const restore = vi.fn<() => Promise<void>>(async () => {})
  f.install.mockImplementation(() => {})
  await registerUpdates('/unused', async (beforeStop) => {
    await beforeStop()
    return restore
  }).check()
  f.listeners.get('error')?.(new Error('Installer rejected update'))
  await vi.waitFor(() => expect(restore).toHaveBeenCalledOnce())
  f.listeners.get('error')?.(new Error('Repeated error'))
  expect(restore).toHaveBeenCalledOnce()
})

it('opens Linux package downloads without attempting an AppImage update for DEB/RPM installs', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
  vi.stubEnv('APPIMAGE', '')
  const { registerUpdates } = await import('./updates')
  const prepare = vi.fn<(beforeStop: () => Promise<void>) => Promise<() => Promise<void>>>(
    async (beforeStop) => {
      await beforeStop()
      return async () => {}
    },
  )
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
  await registerUpdates('/unused', async (beforeStop) => {
    await beforeStop()
    return async () => {}
  }).check()
  expect(updater.allowPrerelease).toBe(true)
  expect(f.open).toHaveBeenCalledWith('https://github.com/dovocode/dovo-studio/releases?q=nightly')
})

it('downloads remotely without a host dialog and restarts only after an explicit command', async () => {
  stubRuntimeFetch(
    vi.fn<typeof fetch>(async (input) =>
      Response.json(
        requestUrl(input).endsWith('/prepare-restart') ? { id: 'restart-lease' } : snapshot,
      ),
    ),
  )
  const { registerUpdates } = await import('./updates')
  const prepare = vi.fn<(beforeStop: () => Promise<void>) => Promise<() => Promise<void>>>(
    async (beforeStop) => {
      await beforeStop()
      return async () => {}
    },
  )
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
  stubRuntimeFetch(
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
  const updates = registerUpdates('/unused', async (beforeStop) => {
    await beforeStop()
    return async () => {}
  })
  await expect(updates.remote('restart', 'next')).rejects.toThrow('Download')
  await updates.remote('download', 'next')
  await expect(updates.remote('restart', 'next')).rejects.toThrow('Finish running')
  expect(f.install).not.toHaveBeenCalled()
  expect(f.message).not.toHaveBeenCalled()
})

it('persists a selected channel and clears release metadata from the previous channel', async () => {
  const { registerUpdates } = await import('./updates')
  const updater = (await import('electron-updater')).default.autoUpdater
  const updates = registerUpdates('/unused', async (beforeStop) => {
    await beforeStop()
    return async () => {}
  })
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
  const updates = registerUpdates('/unused', async (beforeStop) => {
    await beforeStop()
    return async () => {}
  })
  expect(updates.state().channel).toBe('stable')
  expect(updater.allowPrerelease).toBe(false)
  expect(updater.allowDowngrade).toBe(true)
})

it('keeps a downloaded update on its selected channel until installation', async () => {
  f.message.mockResolvedValueOnce({ response: 1 })
  const { registerUpdates } = await import('./updates')
  const updates = registerUpdates('/unused', async (beforeStop) => {
    await beforeStop()
    return async () => {}
  })
  await updates.install()
  await expect(updates.setChannel('nightly')).rejects.toThrow('Finish the current update')
  expect(updates.state().channel).toBe('stable')
  expect(writeLocalSettingsSection).not.toHaveBeenCalled()
})

it('uses the architecture-specific feed when checking Windows ARM nightly releases', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  vi.spyOn(process, 'arch', 'get').mockReturnValue('arm64')
  f.publicReleaseFetch.mockImplementation(async (input) =>
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
  )
  const { registerUpdates } = await import('./updates')
  const updater = (await import('electron-updater')).default.autoUpdater
  await registerUpdates('/unused', async (beforeStop) => {
    await beforeStop()
    return async () => {}
  }).setChannel('nightly')
  expect(updater.channel).toBe('nightly-arm64')
  expect(f.feed).toHaveBeenCalledWith({
    provider: 'generic',
    url: 'https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.43/',
  })
})

it('rechecks an existing offer before downloading the newest release', async () => {
  const { registerUpdates } = await import('./updates')
  const updates = registerUpdates('/unused', async (beforeStop) => {
    await beforeStop()
    return async () => {}
  })
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
  const updates = registerUpdates('/unused', async (beforeStop) => {
    await beforeStop()
    return async () => {}
  })
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
  const updates = registerUpdates('/unused', async (beforeStop) => {
    await beforeStop()
    return async () => {}
  })
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
  expect(
    registerUpdates('/unused', async (beforeStop) => {
      await beforeStop()
      return async () => {}
    }).state().channel,
  ).toBe('stable')
  expect(updater.allowDowngrade).toBe(false)
  f.version = '0.0.7-nightly.42'
  expect(
    registerUpdates('/unused', async (beforeStop) => {
      await beforeStop()
      return async () => {}
    }).state().channel,
  ).toBe('nightly')
  expect(updater.allowPrerelease).toBe(true)
  expect(updater.allowDowngrade).toBe(false)
  expect(writeLocalSettingsSection).not.toHaveBeenCalled()
})
it('allows an explicit stable-to-nightly change despite prerelease version ordering', async () => {
  f.version = '0.0.7'
  const { registerUpdates } = await import('./updates')
  const updater = (await import('electron-updater')).default.autoUpdater
  const updates = registerUpdates('/unused', async (beforeStop) => {
    await beforeStop()
    return async () => {}
  })
  await updates.setChannel('nightly')
  expect(updater.allowPrerelease).toBe(true)
  expect(updater.allowDowngrade).toBe(true)
  expect(writeLocalSettingsSection).toHaveBeenCalledOnce()
})

it.each([false, true])(
  'installs remotely with restart resume choice %s without a host dialog',
  async (resumeInterrupted) => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    vi.spyOn(process, 'arch', 'get').mockReturnValue('x64')
    const request = vi.fn<typeof fetch>(async (input) =>
      (input instanceof Request ? input.url : input.toString()).endsWith('/prepare-restart')
        ? Response.json({ id: 'restart-lease' })
        : Response.json(
            requestUrl(input).endsWith('/prepare-restart') ? { id: 'restart-lease' } : snapshot,
          ),
    )
    stubRuntimeFetch(request)
    const { registerUpdates } = await import('./updates')
    const prepare = vi.fn<(beforeStop: () => Promise<void>) => Promise<() => Promise<void>>>(
      async (beforeStop) => {
        await beforeStop()
        return async () => {}
      },
    )
    const updates = registerUpdates('/unused', prepare)
    await updates.remote('install', 'next', resumeInterrupted)
    expect(f.downloads).toHaveBeenCalledOnce()
    expect(f.install).toHaveBeenCalledExactlyOnceWith(true, true)
    expect(f.message).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledWith(
      'http://fixture/api/runtime/prepare-restart',
      expect.objectContaining({
        body: JSON.stringify({ resumeInterrupted }),
      }),
    )
  },
)

it('cancels restart preparation and keeps the download retryable when shutdown fails', async () => {
  const request = vi.fn<typeof fetch>(async (input) =>
    (input instanceof Request ? input.url : input.toString()).endsWith('/prepare-restart')
      ? Response.json({ id: 'restart-lease' })
      : Response.json(
          requestUrl(input).endsWith('/prepare-restart') ? { id: 'restart-lease' } : snapshot,
        ),
  )
  stubRuntimeFetch(request)
  const { registerUpdates } = await import('./updates')
  const updates = registerUpdates('/unused', async (beforeStop) => {
    await beforeStop()
    throw new Error('Shutdown failed')
  })
  await expect(updates.remote('install', 'next', false)).rejects.toThrow('Shutdown failed')
  expect(updates.state().status).toBe('downloaded')
  expect(request).toHaveBeenCalledWith(
    'http://fixture/api/runtime/cancel-restart',
    expect.objectContaining({
      body: JSON.stringify({ id: 'restart-lease' }),
    }),
  )
  expect(f.install).not.toHaveBeenCalled()
})

it('does not stop the runtime when new work starts while windows are closing', async () => {
  const request = vi.fn<typeof fetch>(async (input) =>
    requestUrl(input).endsWith('/prepare-restart')
      ? Response.json({ error: 'New work is running' }, { status: 409 })
      : Response.json(snapshot),
  )
  stubRuntimeFetch(request)
  const { registerUpdates } = await import('./updates')
  const stopped = vi.fn<() => void>()
  const updates = registerUpdates('/unused', async (beforeStop) => {
    await beforeStop()
    stopped()
    return async () => {}
  })
  await updates.install()
  expect(stopped).not.toHaveBeenCalled()
  expect(f.install).not.toHaveBeenCalled()
  expect(updates.state().error).toContain('prepare')
})

it('does not reserve a restart before an unsaved-edit close prompt is accepted', async () => {
  const request = vi.fn<typeof fetch>(async () => Response.json(snapshot))
  stubRuntimeFetch(request)
  const { registerUpdates } = await import('./updates')
  const updates = registerUpdates('/unused', async () => {
    throw Error('Keep editing')
  })
  await updates.install()
  expect(request.mock.calls.every(([url]) => !requestUrl(url).includes('prepare-restart'))).toBe(
    true,
  )
  expect(f.install).not.toHaveBeenCalled()
})

it.each([0, 1])('offers a local restart with work retained, choice %s', async (choice) => {
  const request = vi.fn<typeof fetch>(async (input) =>
    Response.json(
      requestUrl(input).endsWith('/prepare-restart')
        ? { id: 'restart-lease' }
        : {
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
          },
    ),
  )
  stubRuntimeFetch(request)
  // First choose Later after downloading. The downloaded action must then offer recovery.
  f.message.mockResolvedValueOnce({ response: 1 })
  const { registerUpdates } = await import('./updates')
  const prepare = vi.fn<(beforeStop: () => Promise<void>) => Promise<() => Promise<void>>>(
    async (beforeStop) => {
      await beforeStop()
      return async () => {}
    },
  )
  const updates = registerUpdates('/unused', prepare)
  await updates.install()
  expect(updates.state().status).toBe('downloaded')
  f.message.mockResolvedValueOnce({ response: choice })
  await updates.install()
  expect(f.message).toHaveBeenLastCalledWith(
    expect.objectContaining({
      buttons: ['Restart and resume', 'Later'],
      defaultId: 1,
      cancelId: 1,
    }),
  )
  expect(f.install).toHaveBeenCalledTimes(choice === 0 ? 1 : 0)
  expect(prepare).toHaveBeenCalledTimes(choice === 0 ? 1 : 0)
  expect(
    request.mock.calls
      .filter(([input]) => requestUrl(input).endsWith('/prepare-restart'))
      .map(([, init]) => init?.body),
  ).toEqual(choice === 0 ? [JSON.stringify({ resumeInterrupted: true })] : [])
  expect(updates.state().status).toBe(choice === 0 ? 'restarting' : 'downloaded')
  expect(f.downloads).toHaveBeenCalledOnce()
})

it('does not treat a running replica from another computer as local work', async () => {
  const replica = {
    id: 'remote-copy',
    title: 'Remote work',
    repositoryId: 'repo',
    agentId: '',
    status: 'running',
    createdAt: '',
    messages: [],
    files: [],
    draft: '',
    example: false,
    execution: 'main',
    turns: [],
    replica: {
      ownerRuntimeId: 'remote',
      threadId: 'remote-thread',
      ownerName: 'Remote',
      projectName: 'Project',
    },
  }
  const request = vi.fn<typeof fetch>(async (input) =>
    Response.json(
      requestUrl(input).endsWith('/prepare-restart')
        ? { id: 'restart-lease' }
        : { ...snapshot, workspace: { ...snapshot.workspace, tasks: [replica] } },
    ),
  )
  stubRuntimeFetch(request)
  const { registerUpdates } = await import('./updates')
  const updates = registerUpdates('/unused', async (beforeStop) => {
    await beforeStop()
    return async () => {}
  })
  await updates.install()
  expect(f.message).toHaveBeenCalledOnce()
  expect(f.message).toHaveBeenCalledWith(
    expect.objectContaining({ buttons: ['Restart and install', 'Later'] }),
  )
  expect(f.install).toHaveBeenCalledOnce()
  expect(request).toHaveBeenCalledWith(
    'http://fixture/api/runtime/prepare-restart',
    expect.objectContaining({ body: '{}' }),
  )
})

it('offers restart recovery for live native subagents between parent turns', async () => {
  const task = {
    id: 'parent',
    title: 'Review',
    repositoryId: 'repo',
    agentId: '',
    status: 'review',
    createdAt: '',
    messages: [],
    files: [],
    draft: '',
    example: false,
    subagents: [
      {
        id: 'child',
        provider: 'claude',
        name: 'Reviewer',
        status: 'working',
        sessionLive: true,
        startedAt: '',
        updatedAt: '',
      },
    ],
  }
  const request = vi.fn<typeof fetch>(async (input) =>
    Response.json(
      requestUrl(input).endsWith('/prepare-restart')
        ? { id: 'restart-lease' }
        : { ...snapshot, workspace: { ...snapshot.workspace, tasks: [task] } },
    ),
  )
  stubRuntimeFetch(request)
  const { registerUpdates } = await import('./updates')
  const updates = registerUpdates('/unused', async (beforeStop) => {
    await beforeStop()
    return async () => {}
  })
  f.message.mockResolvedValueOnce({ response: 0 }).mockResolvedValueOnce({ response: 1 })
  await updates.install()
  expect(f.message).toHaveBeenLastCalledWith(
    expect.objectContaining({ buttons: ['Restart and resume', 'Later'] }),
  )
  expect(f.install).not.toHaveBeenCalled()
  expect(updates.state().status).toBe('downloaded')
})
