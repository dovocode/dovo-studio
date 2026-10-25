import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'

const f = vi.hoisted(() => ({
  invoke: undefined as
    | ((event: Electron.IpcMainInvokeEvent, value: unknown) => Promise<void>)
    | undefined,
  windows: [] as MockWindow[],
  trust: vi.fn<(event: Electron.IpcMainInvokeEvent, path: string) => void>(),
  load: vi.fn<() => Promise<void>>(),
  enabled: false,
}))
class MockWindow {
  destroyed = false
  callbacks = new Map<string, () => void>()
  show = vi.fn<() => void>()
  focus = vi.fn<() => void>()
  restore = vi.fn<() => void>()
  isMinimized = () => true
  isDestroyed = () => this.destroyed
  webContents = {
    setWindowOpenHandler: vi.fn<() => void>(),
    on: vi.fn<() => void>(),
    once: vi.fn<() => void>(),
  }
  constructor(readonly options: Electron.BrowserWindowConstructorOptions) {
    f.windows.push(this)
  }
  once(name: string, callback: () => void) {
    this.callbacks.set(name, callback)
  }
  loadFile = vi.fn<(path: string, options: { hash: string }) => Promise<void>>(() => f.load())
  loadURL = vi.fn<(url: string) => Promise<void>>(() => f.load())
  destroy() {
    this.destroyed = true
    this.callbacks.get('closed')?.()
  }
}
vi.mock('electron', () => ({
  app: { getPath: () => '/unused' },
  nativeTheme: { shouldUseDarkColors: true },
  BrowserWindow: class {
    constructor(options: Electron.BrowserWindowConstructorOptions) {
      return new MockWindow(options)
    }
  },
  ipcMain: {
    handle: (_name: string, callback: typeof f.invoke) => {
      f.invoke = callback
    },
  },
}))
vi.mock('./renderer-trust', () => ({
  requireTrustedRenderer: f.trust,
  trustedRendererUrl: () => true,
}))
vi.mock('./window-colors', () => ({
  readWindowColors: () => null,
  defaultWindowColors: () => ({ background: '#111111', symbol: '#ffffff' }),
  titleBarOverlay: () => ({ color: '#111111' }),
}))
vi.mock('./links', () => ({ offerLink: vi.fn<() => Promise<void>>() }))
vi.mock('./quit-shortcut', () => ({ registerQuitShortcut: () => {} }))
import { registerBrowserWindows } from './browser-window'
vi.mock('@dovo/protocol/local-settings', () => ({
  readLocalSettingsSection: () => ({ browserWorkspaceEnabled: f.enabled }),
}))
const event = {} as Electron.IpcMainInvokeEvent

let registration: ReturnType<typeof registerBrowserWindows>
beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  f.windows.splice(0)
  f.enabled = true
  f.load.mockResolvedValue()
  registration = registerBrowserWindows('/app/index.html', '/app/preload.mjs')
})
afterEach(() => registration.dispose())
it('requires opt-in and a trusted Studio renderer before creating any window', async () => {
  f.enabled = false
  await expect(f.invoke!(event, undefined)).rejects.toThrow('Enable experimental Browser')
  expect(f.windows).toHaveLength(0)
  f.enabled = true
  f.trust.mockImplementationOnce(() => {
    throw new Error('Untrusted desktop request')
  })
  await expect(f.invoke!(event, undefined)).rejects.toThrow('Untrusted')
  expect(f.windows).toHaveLength(0)
})
it('opens independent tab-workspace identities in hardened Studio windows', async () => {
  await f.invoke!(event, undefined)
  await f.invoke!(event, undefined)
  expect(f.windows).toHaveLength(2)
  const hashes = f.windows.map((window) => window.loadFile.mock.calls[0]?.[1].hash)
  expect(new Set(hashes).size).toBe(2)
  for (const window of f.windows) {
    expect(window.options.webPreferences).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: '/app/preload.mjs',
    })
    expect(window.loadFile).toHaveBeenCalledWith('/app/index.html', {
      hash: expect.stringMatching(/^browser-window=[a-f0-9-]{36}$/),
    })
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
  }
})
it('bounds windows and releases slots after close', async () => {
  for (let index = 0; index < 10; index++) await f.invoke!(event, undefined)
  await expect(f.invoke!(event, undefined)).rejects.toThrow('more than 10')
  f.windows[0]!.destroy()
  await f.invoke!(event, undefined)
  expect(f.windows).toHaveLength(11)
})
it('destroys a failed-load window and keeps the registry usable', async () => {
  f.load.mockRejectedValueOnce(new Error('load failed'))
  await expect(f.invoke!(event, undefined)).rejects.toThrow('load failed')
  expect(f.windows[0]!.destroyed).toBe(true)
  await expect(f.invoke!(event, undefined)).resolves.toBeUndefined()
})
