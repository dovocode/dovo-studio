import { afterAll, beforeAll, expect, it, vi } from 'vite-plus/test'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const fixture = vi.hoisted(() => {
  const resourcesDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
  Object.defineProperty(process, 'resourcesPath', {
    value: '/tmp/dovo-test-resources',
    configurable: true,
  })
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  return {
    resourcesDescriptor,
    readClipboard: vi.fn<() => string>(() => 'native clipboard'),
    closeWindows: vi.fn<() => Promise<boolean>>(async () => true),
    copy: vi.fn<(text: string) => Promise<void>>(async () => {}),
    handlers,
    appHandlers: new Map<string, (...args: unknown[]) => void>(),
    windows: 0,
    closedWindows: false,
    ipc: vi.fn<
      (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => void
    >((channel, listener) => {
      handlers.set(channel, listener)
    }),
    quit: vi.fn<() => void>(),
    returnBrowserTabs: vi.fn<() => Promise<void>>(async () => {}),
    browserQuitting: vi.fn<(ready: boolean) => void>(),
    stop: vi.fn<() => Promise<void>>(async () => {}),
    error: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
    startupErrors: [] as unknown[][],
    startupIpc: [] as string[],
    startupUpdates: 0,
    prepareUpdate: undefined as
      | Parameters<typeof import('./updates').registerUpdates>[1]
      | undefined,
    startupQuits: 0,
    translated: false,
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
afterAll(() => {
  if (fixture.resourcesDescriptor)
    Object.defineProperty(process, 'resourcesPath', fixture.resourcesDescriptor)
  else Reflect.deleteProperty(process, 'resourcesPath')
})
vi.mock('./dictation.js', () => ({ registerDictation: () => ({ dispose: () => {} }) }))
vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    get runningUnderARM64Translation() {
      return fixture.translated
    },
    getVersion: () => '0.0.7',
    getPath: () => '/tmp/dovo-startup-unit-test',
    commandLine: {
      hasSwitch: () => true,
      appendSwitch: vi.fn<(switchName: string, value?: string) => void>(),
    },
    setName: vi.fn<(...args: unknown[]) => void>(),
    setPath: vi.fn<(...args: unknown[]) => void>(),
    on: vi.fn<(name: string, listener: (...args: unknown[]) => void) => void>((name, listener) => {
      fixture.appHandlers.set(name, listener)
    }),
    once: vi.fn<(...args: unknown[]) => void>(),
    whenReady: () => Promise.resolve(),
    requestSingleInstanceLock: () => true,
    quit: fixture.quit,
  },
  clipboard: { writeText: fixture.copy, readText: fixture.readClipboard },
  nativeTheme: { shouldUseDarkColors: true },
  BrowserWindow: class {
    webContents = {
      setWindowOpenHandler: vi.fn<(...args: unknown[]) => void>(),
      on: vi.fn<(...args: unknown[]) => void>(),
      once: vi.fn<(...args: unknown[]) => void>(),
    }
    once = vi.fn<(...args: unknown[]) => void>()
    isDestroyed = () => fixture.closedWindows
    constructor() {
      fixture.windows++
      fixture.closedWindows = false
    }
    loadFile() {
      return Promise.resolve()
    }
    static getAllWindows() {
      return []
    }
  },
  ipcMain: { handle: fixture.ipc, on: fixture.ipc },
  dialog: { showMessageBox: fixture.error },
}))
vi.mock('./window-unload.js', () => ({
  registerWindowUnload: vi.fn<() => void>(),
  closeStudioWindows: fixture.closeWindows,
}))
vi.mock('./runtime-connection-health.js', () => ({ checkRuntimeConnection: fixture.confirm }))
vi.mock('./remote-updates.js', () => ({ registerRemoteUpdates: async () => undefined }))
vi.mock('./linux-desktop.js', () => ({
  registerLinuxDesktop: vi.fn<typeof import('./linux-desktop.js').registerLinuxDesktop>(),
}))
vi.mock('./task-launcher.js', () => ({ registerTaskLauncher: () => ({ dispose: () => {} }) }))
vi.mock('./terminal-ports.js', () => ({ registerTerminalPorts: () => ({ dispose: () => {} }) }))
vi.mock('./updates.js', () => ({ registerUpdates: fixture.updates }))
vi.mock('./browser.js', () => ({
  registerBrowser: vi.fn<(...args: unknown[]) => { dispose: () => Promise<void> }>(() => ({
    dispose: async () => {},
  })),
}))
vi.mock('./browser-window.js', () => ({
  registerBrowserWindows: () => ({
    create: vi.fn<() => Promise<import('electron').BrowserWindow>>(),
    list: () => [],
    onClose: () => {},
    returnAll: fixture.returnBrowserTabs,
    setQuitting: fixture.browserQuitting,
    dispose: () => {},
  }),
}))
vi.mock('./links.js', () => ({
  queueExternalLinks: vi.fn<typeof import('./links.js').queueExternalLinks>(),
  flushExternalLinks: vi.fn<typeof import('./links.js').flushExternalLinks>(async () => {}),
  setLinkReceiver: vi.fn<typeof import('./links.js').setLinkReceiver>(),
  offerLink: vi.fn<(...args: unknown[]) => Promise<void>>(),
  openExternalLink: vi.fn<(url: string) => Promise<void>>(),
}))
vi.mock('./connection-storage.js', () => ({
  registerConnectionStorage: vi.fn<(...args: unknown[]) => void>(),
}))
vi.mock('./local-runtime.js', () => ({
  startLocalRuntime: fixture.start,
  pauseLocalRuntime: fixture.pause,
  stopLocalRuntime: fixture.stop,
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

// The first import transforms the complete main-process dependency graph. Keep
// that shared setup out of the recovery assertion's budget on cold Windows CI.
beforeAll(async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    await import('./main')
    await vi.waitUntil(() =>
      log.mock.calls.some(
        ([message, detail]) =>
          message === 'Local runtime needs attention:' &&
          detail === 'Runtime protocol is incompatible',
      ),
    )
    fixture.startupErrors = log.mock.calls.map((args) => [...args])
    // The runner clears mock calls between setup and tests; retain startup
    // observations independently of the mocks used by subsequent scenarios.
    fixture.startupIpc = fixture.ipc.mock.calls.map(([channel]) => channel)
    fixture.startupUpdates = fixture.updates.mock.calls.length
    fixture.prepareUpdate = vi.mocked(
      (await import('./updates')).registerUpdates,
    ).mock.calls[0]?.[1]
    fixture.startupQuits = fixture.quit.mock.calls.length
  } finally {
    log.mockRestore()
  }
})

it('opens the recovery UI and registers updates when the installed runtime is incompatible', () => {
  expect(fixture.windows).toBe(1)
  expect(fixture.startupIpc).toContain('app:info')
  expect(fixture.handlers.get('app:info')).toEqual(expect.any(Function))
  expect(fixture.startupUpdates).toBe(1)
  expect(fixture.startupQuits).toBe(0)
  expect(fixture.startupErrors).toContainEqual([
    'Local runtime needs attention:',
    'Runtime protocol is incompatible',
  ])
})

it('rejects untrusted senders before returning runtime credentials or activating extensions', async () => {
  await import('./main')
  for (const channel of [
    'links:ready',
    'links:browser',
    'links:external',
    'runtime:connection',
    'runtime:list-extensions',
    'runtime:activate',
    'runtime:windows-read',
    'runtime:windows-save',
    'runtime:windows-connection',
    'runtime:windows-security',
    'app:info',
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

it.each([
  { platform: 'darwin', arch: 'arm64', translated: false, architecture: 'arm64' },
  { platform: 'darwin', arch: 'x64', translated: false, architecture: 'x64' },
  { platform: 'darwin', arch: 'x64', translated: true, architecture: 'arm64' },
  { platform: 'win32', arch: 'x64', translated: false, architecture: 'x64' },
  { platform: 'win32', arch: 'x64', translated: true, architecture: 'arm64' },
  { platform: 'linux', arch: 'arm64', translated: false, architecture: 'arm64' },
] as const)(
  'reports the desktop viewer from the host: $platform/$arch, translated=$translated',
  ({ platform, arch, translated, architecture }) => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
    const archSpy = vi.spyOn(process, 'arch', 'get').mockReturnValue(arch)
    fixture.translated = translated
    try {
      const handler = fixture.handlers.get('app:info')
      if (!handler) throw new Error('Missing app info handler')
      const event = { ...trustedEvent(), returnValue: undefined }
      handler(event)
      expect(event.returnValue).toEqual({
        version: '0.0.7',
        channel: 'stable',
        viewer: { platform, architecture, processArchitecture: arch },
      })
    } finally {
      fixture.translated = false
      platformSpy.mockRestore()
      archSpy.mockRestore()
    }
  },
)

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

it('registers only validated link receiver readiness from the trusted owning renderer', async () => {
  await import('./main')
  const { setLinkReceiver } = await import('./links.js')
  const handler = fixture.handlers.get('links:ready')
  if (!handler) throw new Error('Missing link receiver handler')
  const event = trustedEvent()
  handler(event, true)
  expect(setLinkReceiver).toHaveBeenCalledWith(event.sender, true)
  handler(event, false)
  expect(setLinkReceiver).toHaveBeenCalledWith(event.sender, false)
  expect(() => handler(event, 'true')).toThrow('Expected link receiver readiness')
})

it('keeps the runtime alive when update closing is cancelled and reopens after preparation fails', async () => {
  const { prepareLocalRuntimeUpdate } = await import('./local-runtime')
  const prepare = fixture.prepareUpdate
  if (!prepare) throw new Error('Missing update preparation')
  fixture.closeWindows.mockClear()
  fixture.closeWindows.mockResolvedValueOnce(false)
  const beforeStop = vi.fn<() => Promise<void>>(async () => {})
  await expect(prepare(beforeStop)).rejects.toThrow('Update cancelled')
  expect(prepareLocalRuntimeUpdate).not.toHaveBeenCalled()
  expect(beforeStop).not.toHaveBeenCalled()
  const windows = fixture.windows
  const quits = fixture.quit.mock.calls.length
  fixture.closeWindows.mockImplementationOnce(async () => {
    fixture.closedWindows = true
    fixture.appHandlers.get('window-all-closed')?.()
    return true
  })
  vi.mocked(prepareLocalRuntimeUpdate).mockRejectedValueOnce(new Error('Preparation failed'))
  await expect(prepare(beforeStop)).rejects.toThrow('Preparation failed')
  expect(beforeStop).toHaveBeenCalledOnce()
  expect(fixture.quit).toHaveBeenCalledTimes(quits)
  expect(fixture.windows).toBe(windows + 1)
  fixture.closeWindows.mockClear()
})

it('keeps repeated quit requests blocked until detached tabs are saved, and permits retry on failure', async () => {
  await import('./main')
  const beforeQuit = fixture.appHandlers.get('before-quit')
  if (!beforeQuit) throw new Error('Missing shutdown handler')
  const event = { preventDefault: vi.fn<() => void>() }
  fixture.stop.mockClear()
  fixture.returnBrowserTabs.mockRejectedValueOnce(new Error('Storage is full'))
  beforeQuit(event)
  await vi.waitFor(() => expect(fixture.error).toHaveBeenCalled())
  expect(fixture.quit).not.toHaveBeenCalled()
  expect(fixture.stop).not.toHaveBeenCalled()
  expect(fixture.browserQuitting).not.toHaveBeenCalledWith(true)

  fixture.closeWindows.mockResolvedValueOnce(false)
  beforeQuit(event)
  await vi.waitFor(() => expect(fixture.closeWindows).toHaveBeenCalledOnce())
  expect(fixture.stop).not.toHaveBeenCalled()
  expect(fixture.quit).not.toHaveBeenCalled()

  let saved = () => {}
  fixture.returnBrowserTabs.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        saved = resolve
      }),
  )
  beforeQuit(event)
  beforeQuit(event)
  expect(event.preventDefault).toHaveBeenCalledTimes(4)
  expect(fixture.returnBrowserTabs).toHaveBeenCalledTimes(3)
  expect(fixture.stop).not.toHaveBeenCalled()
  expect(fixture.quit).not.toHaveBeenCalled()
  saved()
  await vi.waitFor(() => expect(fixture.quit).toHaveBeenCalledOnce())
  expect(fixture.stop).toHaveBeenCalledOnce()
  expect(fixture.browserQuitting).toHaveBeenLastCalledWith(true)
  beforeQuit(event)
  expect(event.preventDefault).toHaveBeenCalledTimes(4)
})

it('copies through the trusted Studio bridge without requiring renderer focus', async () => {
  const copy = fixture.handlers.get('clipboard:write-text')
  if (!copy) throw new Error('Missing clipboard handler')
  const url = pathToFileURL(
    join(dirname(fileURLToPath(import.meta.url)), '../dist/index.html'),
  ).href
  const mainFrame = { url }
  const event = { senderFrame: mainFrame, sender: { mainFrame } }
  await copy(event, 'Full thread selection ✓')
  expect(fixture.copy).toHaveBeenLastCalledWith('Full thread selection ✓')
  await expect(
    copy({ ...event, senderFrame: { url: 'https://example.com/' } }, 'website'),
  ).rejects.toThrow('Untrusted')
  await expect(copy(event, {})).rejects.toThrow('Expected clipboard text')
})

it('reads clipboard text only for a trusted Studio renderer', () => {
  const read = fixture.handlers.get('clipboard:read-text')
  if (!read) throw new Error('Missing clipboard reader')
  expect(read(trustedEvent())).toBe('native clipboard')
  expect(() =>
    read({ senderFrame: { url: 'https://website.test' }, sender: { mainFrame: {} } }),
  ).toThrow('Untrusted')
})
