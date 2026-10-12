import { beforeEach, expect, it, vi } from 'vite-plus/test'

const f = vi.hoisted(() => ({
  invoke: undefined as
    | ((event: Electron.IpcMainInvokeEvent, value: unknown) => Promise<void>)
    | undefined,
  windows: [] as MockWindow[],
  trust: vi.fn<(event: Electron.IpcMainInvokeEvent, path: string) => void>(),
  load: vi.fn<() => Promise<void>>(),
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
import { registerThreadWindows } from './thread-window'
const event = {} as Electron.IpcMainInvokeEvent
const target = { runtimeId: 'http://remote.lan:8787', taskId: 'task / #1', title: 'Thread title' }
beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  f.windows.splice(0)
  f.load.mockResolvedValue()
})
it('opens a standalone thread on its owning computer, reuses it, and releases closed windows', async () => {
  const bridge = registerThreadWindows('/app/index.html', '/app/preload.mjs')
  await f.invoke?.(event, target)
  const window = f.windows[0]!
  expect(window.options.webPreferences).toMatchObject({
    sandbox: true,
    nodeIntegration: false,
    contextIsolation: true,
  })
  expect(window.loadFile).toHaveBeenCalledWith('/app/index.html', {
    hash: 'thread=' + encodeURIComponent(JSON.stringify(target)),
  })
  expect(window.show).toHaveBeenCalledOnce()
  await f.invoke?.(event, target)
  expect(f.windows).toHaveLength(1)
  expect(window.restore).toHaveBeenCalledOnce()
  expect(window.focus).toHaveBeenCalledTimes(2)
  await f.invoke?.(event, { ...target, runtimeId: 'http://other.lan:8787' })
  expect(f.windows).toHaveLength(2)
  window.destroy()
  await f.invoke?.(event, target)
  expect(f.windows).toHaveLength(3)
  bridge.dispose()
  expect(f.windows.every((window) => window.destroyed)).toBe(true)
})
it('rejects untrusted requests and invalid destinations before creating a window', async () => {
  registerThreadWindows('/app/index.html', '/app/preload.mjs')
  f.trust.mockImplementationOnce(() => {
    throw new Error('Untrusted desktop request')
  })
  await expect(f.invoke?.(event, target)).rejects.toThrow('Untrusted')
  await expect(f.invoke?.(event, { ...target, taskId: '' })).rejects.toThrow('Expected at least 1')
  expect(f.windows).toHaveLength(0)
})
it('loads the development renderer and cleans up a failed window so opening can be retried', async () => {
  vi.stubEnv('VITE_DEV_SERVER_URL', 'http://localhost:5173')
  registerThreadWindows('/app/index.html', '/app/preload.mjs')
  f.load.mockRejectedValueOnce(new Error('Load failed'))
  await expect(f.invoke?.(event, target)).rejects.toThrow('Load failed')
  expect(f.windows[0]?.destroyed).toBe(true)
  await f.invoke?.(event, target)
  const url = new URL(f.windows[1]!.loadURL.mock.calls[0]![0])
  expect(url.origin).toBe('http://localhost:5173')
  expect(JSON.parse(decodeURIComponent(url.hash.slice('#thread='.length)))).toEqual(target)
})
