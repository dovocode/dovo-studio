import { expect, it, vi } from 'vite-plus/test'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const fixture = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  return {
    handlers,
    windows: 0,
    ipc: vi.fn<
      (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => void
    >((channel, listener) => {
      handlers.set(channel, listener)
    }),
    quit: vi.fn<() => void>(),
    choice: undefined as import('@dovo/protocol').WindowsRuntimeChoice | undefined,
    start: vi.fn<() => Promise<{ address: string; token: string }>>(() =>
      Promise.reject(new Error('Runtime protocol is incompatible')),
    ),
    confirm: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    pause: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    updates: vi.fn<(...args: unknown[]) => unknown>(() =>
      Object.assign(async () => {}, {
        state: () => ({ status: 'idle' }),
        refresh: async () => false,
        install: async () => {},
      }),
    ),
  }
})
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
  nativeTheme: { shouldUseDarkColors: true },
  BrowserWindow: class {
    webContents = {
      setWindowOpenHandler: vi.fn<(...args: unknown[]) => void>(),
      on: vi.fn<(...args: unknown[]) => void>(),
      once: vi.fn<(...args: unknown[]) => void>(),
    }
    once = vi.fn<(...args: unknown[]) => void>()
    isDestroyed = () => false
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
vi.mock('./runtime-connection-health.js', () => ({ checkRuntimeConnection: fixture.confirm }))
vi.mock('./remote-updates.js', () => ({ registerRemoteUpdates: async () => undefined }))
vi.mock('./linux-desktop.js', () => ({
  registerLinuxDesktop: vi.fn<typeof import('./linux-desktop.js').registerLinuxDesktop>(),
}))
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
    'runtime:windows-security',
  ]) {
    const handler = fixture.handlers.get(channel)
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
  const save = fixture.handlers.get('runtime:windows-save')
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
  const save = fixture.handlers.get('runtime:windows-save')
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

it('blocks connection polling from restarting a runtime while its environment switches', async () => {
  await import('./main')
  const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  const connection = {
    address: 'http://127.0.0.1:54321',
    token: 'native-owned-token-at-least-thirty-two-characters',
  }
  fixture.choice = { mode: 'native' }
  let finish = () => {}
  fixture.start.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () => resolve(connection)
      }),
  )
  const save = fixture.handlers.get('runtime:windows-save')
  const connect = fixture.handlers.get('runtime:connection')
  const windowsConnect = fixture.handlers.get('runtime:windows-connection')
  if (!save || !connect || !windowsConnect) throw new Error('Missing runtime handlers')
  const saving = Promise.resolve(save(trustedEvent(), { mode: 'native' }))
  try {
    await expect(Promise.resolve().then(() => connect(trustedEvent()))).rejects.toThrow(
      'switch is already in progress',
    )
    await expect(Promise.resolve().then(() => windowsConnect(trustedEvent()))).rejects.toThrow(
      'switch is already in progress',
    )
    expect(fixture.start).toHaveBeenCalledOnce()
  } finally {
    finish()
    await saving
    platform.mockRestore()
    fixture.start.mockReset()
    fixture.start.mockRejectedValue(new Error('Runtime protocol is incompatible'))
  }
})

it('does not save Native Windows setup until its returned connection is verified', async () => {
  await import('./main')
  const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  fixture.choice = undefined
  fixture.start.mockResolvedValue({
    address: 'http://127.0.0.1:34267',
    token: 'owner-token-at-least-thirty-two-characters',
  })
  fixture.confirm.mockRejectedValueOnce(new TypeError('fetch failed'))
  const save = fixture.handlers.get('runtime:windows-save')
  if (!save) throw new Error('Missing environment save handler')
  try {
    await expect(save(trustedEvent(), { mode: 'native' })).rejects.toThrow(
      'The local runtime is not accepting the connection',
    )
    expect(fixture.choice).toBeUndefined()
  } finally {
    platform.mockRestore()
    log.mockRestore()
    fixture.start.mockReset()
    fixture.start.mockRejectedValue(new Error('Runtime protocol is incompatible'))
  }
})

it('clearly reports when a failed switch also cannot restore the previous connection', async () => {
  await import('./main')
  const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  fixture.choice = { mode: 'native' }
  fixture.start.mockImplementation(async () => {
    throw new Error(
      fixture.choice?.mode === 'wsl' ? 'WSL startup failed' : 'Native recovery failed',
    )
  })
  const save = fixture.handlers.get('runtime:windows-save')
  if (!save) throw new Error('Missing environment save handler')
  try {
    await expect(save(trustedEvent(), { mode: 'wsl', distribution: 'Ubuntu' })).rejects.toThrow(
      'Runtime switch and recovery failed: WSL startup failed; Native recovery failed',
    )
  } finally {
    platform.mockRestore()
    log.mockRestore()
    fixture.start.mockReset()
    fixture.start.mockRejectedValue(new Error('Runtime protocol is incompatible'))
  }
})

it('verifies recovery before telling the user that the previous environment was restored', async () => {
  await import('./main')
  const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  fixture.choice = { mode: 'native' }
  fixture.start.mockResolvedValue({
    address: 'http://127.0.0.1:34267',
    token: 'owner-token-at-least-thirty-two-characters',
  })
  fixture.confirm.mockRejectedValueOnce(new TypeError('fetch failed'))
  const save = fixture.handlers.get('runtime:windows-save')
  if (!save) throw new Error('Missing environment save handler')
  try {
    await expect(save(trustedEvent(), { mode: 'wsl', distribution: 'Ubuntu' })).rejects.toThrow(
      'The previous execution environment was restored.',
    )
    expect(fixture.confirm).toHaveBeenCalledTimes(2)
    expect(fixture.choice).toEqual({ mode: 'native' })
  } finally {
    platform.mockRestore()
    log.mockRestore()
    fixture.start.mockReset()
    fixture.start.mockRejectedValue(new Error('Runtime protocol is incompatible'))
  }
})
