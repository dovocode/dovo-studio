import { afterEach, expect, it, vi } from 'vite-plus/test'
const f = vi.hoisted(() => ({
  open: vi.fn(async (_url: string) => {}),
  listeners: new Map<string, (error: Error) => void>(),
  install: vi.fn<() => void>(),
  message: vi.fn<(options: unknown) => Promise<{ response: number }>>(async () => ({
    response: 0,
  })),
}))
vi.mock('electron', () => ({
  app: { isPackaged: true, getVersion: () => 'fixture' },
  dialog: { showMessageBox: f.message },
  shell: { openExternal: f.open },
  Menu: { buildFromTemplate: (value: unknown) => value, setApplicationMenu: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
}))
vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: {
      on: (name: string, listener: (error: Error) => void) => {
        f.listeners.set(name, listener)
      },
      removeListener: () => {},
      checkForUpdates: async () => ({ isUpdateAvailable: true, updateInfo: { version: 'next' } }),
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
  await registerUpdates('/unused', prepare)()
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
  await registerUpdates('/unused', async () => restore)()
  f.listeners.get('error')?.(new Error('Installer rejected update'))
  await vi.waitFor(() => expect(restore).toHaveBeenCalledOnce())
  f.listeners.get('error')?.(new Error('Repeated error'))
  expect(restore).toHaveBeenCalledOnce()
})

it('opens Linux package downloads without attempting an AppImage update for DEB/RPM installs', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
  vi.stubEnv('APPIMAGE', '')
  const { registerUpdates } = await import('./updates')
  const prepare = vi.fn(async () => async () => {})
  await registerUpdates('/unused', prepare)()
  expect(f.open).toHaveBeenCalledWith('https://github.com/dovocode/dovo-studio/releases/latest')
  expect(prepare).not.toHaveBeenCalled()
  expect(f.install).not.toHaveBeenCalled()
})
