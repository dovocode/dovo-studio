import { expect, it, vi } from 'vite-plus/test'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const fixture = vi.hoisted(() => ({
  windows: 0,
  ipc: vi.fn<
    (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => void
  >(),
  quit: vi.fn<() => void>(),
  choice: undefined as import('@dovo/protocol').WindowsRuntimeChoice | undefined,
  start: vi.fn<() => Promise<{ address: string; token: string }>>(() =>
    Promise.reject(new Error('Runtime protocol is incompatible')),
  ),
  pause: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  updates: vi.fn<(...args: unknown[]) => unknown>(() =>
    Object.assign(async () => {}, {
      state: () => ({ status: 'idle' }),
      refresh: async () => false,
      install: async () => {},
    }),
  ),
}))
vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getVersion: () => '0.0.7',
    getPath: () => '/tmp/dovo-startup-unit-test',
    commandLine: { hasSwitch: () => true },
    setName: vi.fn<(...args: unknown[]) => void>(),
    setPath: vi.fn<(...args: unknown[]) => void>(),
    on: vi.fn<(...args: unknown[]) => void>(),
    once: vi.fn<(...args: unknown[]) => void>(),
    whenReady: () => Promise.resolve(),
    requestSingleInstanceLock: () => true,
    quit: fixture.quit,
  },
  BrowserWindow: class {
    webContents = {
      setWindowOpenHandler: vi.fn<(...args: unknown[]) => void>(),
      on: vi.fn<(...args: unknown[]) => void>(),
      once: vi.fn<(...args: unknown[]) => void>(),
    }
    constructor() {
      fixture.windows++
    }
    loadFile() {
      return Promise.resolve()
    }
    static getAllWindows() {
      return []
    }
  },
  ipcMain: { handle: fixture.ipc, on: fixture.ipc },
  dialog: {},
}))
vi.mock('./remote-updates.js', () => ({ registerRemoteUpdates: async () => undefined }))
vi.mock('./task-launcher.js', () => ({ registerTaskLauncher: () => ({ dispose: () => {} }) }))
vi.mock('./updates.js', () => ({ registerUpdates: fixture.updates }))
vi.mock('./browser.js', () => ({
  registerBrowser: vi.fn<(...args: unknown[]) => { dispose: () => Promise<void> }>(() => ({
    dispose: async () => {},
  })),
}))
vi.mock('./links.js', () => ({
  offerLink: vi.fn<(...args: unknown[]) => Promise<void>>(),
  openExternalLink: vi.fn<(url: string) => Promise<void>>(),
}))
vi.mock('./connection-storage.js', () => ({
  registerConnectionStorage: vi.fn<(...args: unknown[]) => void>(),
}))
vi.mock('./local-runtime.js', () => ({
  startLocalRuntime: fixture.start,
  pauseLocalRuntime: fixture.pause,
  stopLocalRuntime: () => Promise.resolve(),
  prepareLocalRuntimeUpdate: vi.fn<typeof import('./local-runtime').prepareLocalRuntimeUpdate>(),
}))
vi.mock('./windows-runtime.js', () => ({
  readWindowsRuntimeChoice: () => fixture.choice,
  writeWindowsRuntimeChoice: (
    choice: import('@dovo/protocol').WindowsRuntimeChoice | undefined,
  ) => {
    fixture.choice = choice
  },
  prepareWslRuntime: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  windowsRuntimeStatus: vi.fn<() => Promise<unknown>>(() => Promise.resolve({})),
}))

it('opens the recovery UI and registers updates when the installed runtime is incompatible', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    await import('./main')
    await vi.waitFor(() => expect(fixture.windows).toBe(1))
    expect(fixture.ipc).toHaveBeenCalledWith('app:info', expect.any(Function))
    expect(fixture.updates).toHaveBeenCalledOnce()
    expect(fixture.quit).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(
      'Local runtime needs attention:',
      'Runtime protocol is incompatible',
    )
  } finally {
    log.mockRestore()
  }
})

it('rejects untrusted senders before returning runtime credentials or activating extensions', async () => {
  await import('./main')
  for (const channel of [
    'runtime:connection',
    'runtime:list-extensions',
    'runtime:activate',
    'runtime:windows-read',
    'runtime:windows-save',
    'runtime:windows-connection',
  ]) {
    const handler = fixture.ipc.mock.calls.find(([name]) => name === channel)?.[1]
    if (!handler) throw new Error(`Missing IPC handler ${channel}`)
    await expect(
      Promise.resolve().then(() => handler({ senderFrame: null }, 'extension')),
    ).rejects.toThrow('Untrusted desktop request')
  }
})

const trustedEvent = () => {
  const frame = {
    url: pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '../dist/index.html')).href,
  }
  return { senderFrame: frame, sender: { mainFrame: frame } }
}
it('accepts Native Windows setup without restarting active work', async () => {
  await import('./main')
  const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  const connection = {
    address: 'http://127.0.0.1:54321',
    token: 'native-owned-token-at-least-thirty-two-characters',
  }
  fixture.start.mockResolvedValue(connection)
  fixture.choice = undefined
  fixture.pause.mockClear()
  const save = fixture.ipc.mock.calls.find(([name]) => name === 'runtime:windows-save')?.[1]
  if (!save) throw new Error('Missing environment save handler')
  try {
    expect(await save(trustedEvent(), { mode: 'native' })).toEqual(connection)
    expect(fixture.choice).toEqual({ mode: 'native' })
    expect(fixture.pause).not.toHaveBeenCalled()
  } finally {
    platform.mockRestore()
    fixture.start.mockReset()
    fixture.start.mockRejectedValue(new Error('Runtime protocol is incompatible'))
  }
})
it('restores the previous environment when WSL startup fails', async () => {
  await import('./main')
  const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  fixture.choice = { mode: 'native' }
  fixture.pause.mockClear()
  fixture.start.mockImplementation(async () => {
    if (fixture.choice?.mode === 'wsl') throw new Error('WSL startup failed')
    return {
      address: 'http://127.0.0.1:54321',
      token: 'native-owned-token-at-least-thirty-two-characters',
    }
  })
  const save = fixture.ipc.mock.calls.find(([name]) => name === 'runtime:windows-save')?.[1]
  if (!save) throw new Error('Missing environment save handler')
  try {
    await expect(save(trustedEvent(), { mode: 'wsl', distribution: 'Ubuntu' })).rejects.toThrow(
      'WSL startup failed',
    )
    expect(fixture.choice).toEqual({ mode: 'native' })
    expect(fixture.pause).toHaveBeenCalledTimes(2)
  } finally {
    platform.mockRestore()
    fixture.start.mockReset()
    fixture.start.mockRejectedValue(new Error('Runtime protocol is incompatible'))
  }
})
