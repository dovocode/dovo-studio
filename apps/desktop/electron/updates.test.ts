import { afterEach, expect, it, vi } from 'vite-plus/test'
const f = vi.hoisted(() => ({
  open: vi.fn<(url: string) => Promise<void>>(async (_url) => {}),
  listeners: new Map<string, (error: Error) => void>(),
  install: vi.fn<() => void>(),
  message: vi.fn<(options: unknown) => Promise<{ response: number }>>(async () => ({
    response: 0,
  })),
  version: 'fixture',
  menu: undefined as unknown,
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
  BrowserWindow: { getAllWindows: () => [] },
}))
vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: {
      on: (name: string, listener: (error: Error) => void) => {
        f.listeners.set(name, listener)
      },
      removeListener: () => {},
      checkForUpdates: async () => ({
        isUpdateAvailable: true,
        updateInfo: { version: 'next', releaseNotes: 'Faster setup and fixes' },
      }),
      downloadUpdate: async () => {},
      quitAndInstall: f.install,
    },
  },
}))
vi.mock('./local-runtime.js', () => ({
  startLocalRuntime: async () => ({ address: 'http://fixture', token: 'fixture-token' }),
}))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  f.listeners.clear()
  f.version = 'fixture'
  f.menu = undefined
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
  const { registerUpdates } = await import('./updates')
  const updates = registerUpdates('/unused', async () => async () => {})
  await updates.refresh()
  expect(updates.state()).toMatchObject({
    status: 'available',
    version: 'next',
    notes: 'Faster setup and fixes',
  })
  f.message.mockResolvedValueOnce({ response: 1 })
  await updates.install()
  expect(updates.state()).toMatchObject({ status: 'downloaded', progress: 100 })
  expect(f.message).toHaveBeenCalledOnce()
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
