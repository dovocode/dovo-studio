import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'

const f = vi.hoisted(() => ({
  invoke: undefined as
    | ((event: Electron.IpcMainInvokeEvent, value: unknown) => Promise<void>)
    | undefined,
  windows: [] as MockWindow[],
  trust: vi.fn<(event: Electron.IpcMainInvokeEvent, path: string) => void>(),
  load: vi.fn<() => Promise<void>>(),
  dialog: vi.fn<(window: unknown, options: unknown) => Promise<{ response: number }>>(),
}))
type RendererGone = (event: unknown, details: { reason: string; exitCode: number }) => void
class MockWindow {
  destroyed = false
  callbacks = new Map<string, () => void>()
  show = vi.fn<() => void>()
  focus = vi.fn<() => void>()
  restore = vi.fn<() => void>()
  isMinimized = () => true
  isDestroyed = () => this.destroyed
  webContents = {
    listeners: new Map<string, (...args: never[]) => void>(),
    setWindowOpenHandler: vi.fn<() => void>(),
    on: vi.fn<(name: string, callback: (...args: never[]) => void) => void>((name, callback) => {
      this.webContents.listeners.set(name, callback)
    }),
    once: vi.fn<() => void>(),
    reload: vi.fn<() => void>(),
    forcefullyCrashRenderer: vi.fn<() => void>(),
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
  rendererGone(reason = 'crashed') {
    ;(this.webContents.listeners.get('render-process-gone') as RendererGone | undefined)?.(
      {},
      { reason, exitCode: 11 },
    )
  }
  unresponsive() {
    ;(this.webContents.listeners.get('unresponsive') as (() => void) | undefined)?.()
  }
}
vi.mock('electron', () => ({
  app: { getPath: () => '/unused', getName: () => 'Dovo Studio' },
  nativeTheme: { shouldUseDarkColors: true },
  dialog: { showMessageBox: f.dialog },
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
  f.dialog.mockResolvedValue({ response: 0 })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
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
it('waits for a loading pop-out before focusing it instead of showing it blank or twice', async () => {
  registerThreadWindows('/app/index.html', '/app/preload.mjs')
  let finish = () => {}
  f.load.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve
    }),
  )
  const first = f.invoke?.(event, target)
  const second = f.invoke?.(event, target)
  await Promise.resolve()
  const window = f.windows[0]!
  expect(f.windows).toHaveLength(1)
  expect(window.show).not.toHaveBeenCalled()
  finish()
  await Promise.all([first, second])
  expect(window.show).toHaveBeenCalledTimes(2)
  expect(window.focus).toHaveBeenCalledTimes(2)
  // A load failure rejects only the opener; a waiting request falls through and reopens.
  f.load.mockRejectedValueOnce(new Error('Load failed'))
  window.destroy()
  const opener = f.invoke?.(event, target)
  const waiter = f.invoke?.(event, target)
  await expect(opener).rejects.toThrow('Load failed')
  await expect(waiter).resolves.toBeUndefined()
  expect(f.windows[1]?.destroyed).toBe(true)
})
it('reloads a crashed pop-out once per minute, then asks, and closing frees the thread for reopening', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-29T10:00:00Z'))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  registerThreadWindows('/app/index.html', '/app/preload.mjs')
  await f.invoke?.(event, target)
  const window = f.windows[0]!
  window.rendererGone('clean-exit')
  expect(window.webContents.reload).not.toHaveBeenCalled()
  window.rendererGone()
  expect(window.webContents.reload).toHaveBeenCalledOnce()
  expect(f.dialog).not.toHaveBeenCalled()
  // Crashing again inside the window asks rather than looping.
  f.dialog.mockResolvedValueOnce({ response: 0 })
  window.rendererGone()
  await vi.advanceTimersByTimeAsync(0)
  expect(f.dialog).toHaveBeenCalledOnce()
  expect(f.dialog.mock.calls[0]![1]).toMatchObject({ buttons: ['Reload', 'Close window'] })
  expect(window.webContents.reload).toHaveBeenCalledTimes(2)
  // Choosing to close destroys the window and releases its slot: the thread reopens fresh
  // instead of every later request focusing a dead window.
  f.dialog.mockResolvedValueOnce({ response: 1 })
  window.rendererGone()
  await vi.advanceTimersByTimeAsync(0)
  expect(window.destroyed).toBe(true)
  await f.invoke?.(event, target)
  expect(f.windows).toHaveLength(2)
  expect(f.windows[1]!.show).toHaveBeenCalledOnce()
  // After a minute the automatic reload is available again.
  vi.setSystemTime(new Date('2026-10-29T10:02:00Z'))
  f.windows[1]!.rendererGone()
  expect(f.windows[1]!.webContents.reload).toHaveBeenCalledOnce()
  expect(f.dialog).toHaveBeenCalledTimes(2)
})
it('offers to reload a hung pop-out and never touches a window that closed meanwhile', async () => {
  registerThreadWindows('/app/index.html', '/app/preload.mjs')
  await f.invoke?.(event, target)
  const window = f.windows[0]!
  f.dialog.mockResolvedValueOnce({ response: 1 })
  window.unresponsive()
  await vi.waitFor(() => expect(window.webContents.forcefullyCrashRenderer).toHaveBeenCalledOnce())
  let answer: (value: { response: number }) => void = () => {}
  f.dialog.mockReturnValueOnce(
    new Promise<{ response: number }>((resolve) => {
      answer = resolve
    }),
  )
  window.unresponsive()
  window.destroy()
  answer({ response: 1 })
  await Promise.resolve()
  expect(window.webContents.forcefullyCrashRenderer).toHaveBeenCalledOnce()
  window.rendererGone()
  expect(window.webContents.reload).not.toHaveBeenCalled()
})
