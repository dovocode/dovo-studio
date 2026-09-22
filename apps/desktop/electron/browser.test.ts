import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
const mocks = vi.hoisted(() => {
  const contents = {
    setWindowOpenHandler: vi.fn<(...args: unknown[]) => void>(),
    session: {
      setPermissionRequestHandler: vi.fn<(...args: unknown[]) => void>(),
      setPermissionCheckHandler: vi.fn<(...args: unknown[]) => void>(),
    },
    on: vi.fn<(...args: unknown[]) => void>(),
    close: vi.fn<(...args: unknown[]) => void>(),
    isDestroyed: vi.fn<() => boolean>(() => false),
    loadURL: vi.fn<() => Promise<void>>(async () => {}),
    enableDeviceEmulation: vi.fn<(...args: unknown[]) => void>(),
    disableDeviceEmulation: vi.fn<(...args: unknown[]) => void>(),
    navigationHistory: { canGoBack: () => false, canGoForward: () => false },
    getURL: () => 'https://example.com/',
  }
  const view = {
    webContents: contents,
    setVisible: vi.fn<(...args: unknown[]) => void>(),
    setBounds: vi.fn<(...args: unknown[]) => void>(),
  }
  const window = {
    id: 1,
    contentView: {
      addChildView: vi.fn<(...args: unknown[]) => void>(),
      removeChildView: vi.fn<(...args: unknown[]) => void>(),
    },
    getContentSize: () => [900, 700],
    once: vi.fn<(...args: unknown[]) => void>(),
  }
  return {
    view,
    window,
    contents,
    handle:
      vi.fn<
        (name: string, handler: (event: unknown, input: unknown) => Promise<unknown>) => void
      >(),
    create: vi.fn<(...args: unknown[]) => void>(),
  }
})
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: () => mocks.window },
  WebContentsView: class {
    constructor(options: unknown) {
      mocks.create(options)
      return mocks.view
    }
  },
  ipcMain: { handle: mocks.handle },
  shell: { openExternal: vi.fn<(url: string) => Promise<void>>() },
}))
import { registerBrowser } from './browser'
afterEach(() => vi.unstubAllEnvs())
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VITE_DEV_SERVER_URL', '')
})
const frame = { url: 'file:///app/index.html' }
const event = { sender: { mainFrame: frame }, senderFrame: frame }
function handler() {
  registerBrowser('/app/index.html')
  const callback = mocks.handle.mock.calls.at(-1)?.[1]
  if (!callback) throw new Error('Missing IPC handler')
  return callback
}
it('rejects subframes and other pages before creating a browser', async () => {
  const call = handler()
  await expect(
    call(
      { ...event, senderFrame: { url: 'file:///app/index.html' } },
      { action: 'hide', key: 'task' },
    ),
  ).rejects.toThrow('Untrusted')
  const other = { url: 'https://example.com' }
  await expect(
    call({ sender: { mainFrame: other }, senderFrame: other }, { action: 'hide', key: 'task' }),
  ).rejects.toThrow('Untrusted')
  expect(mocks.create).not.toHaveBeenCalled()
})
it('isolates the view, clamps its bounds, ignores stale hides and closes replaced task content', async () => {
  const call = handler()
  const command = {
    action: 'show',
    key: 'first',
    url: 'https://example.com',
    bounds: { x: 800, y: 650, width: 500, height: 400 },
    viewport: { width: 390, height: 844 },
  }
  await call(event, command)
  expect(mocks.create).toHaveBeenCalledWith({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'dovo-preview',
    },
  })
  expect(mocks.view.setBounds).toHaveBeenCalledWith({ x: 800, y: 650, width: 100, height: 50 })
  expect(mocks.contents.enableDeviceEmulation).toHaveBeenCalledWith(
    expect.objectContaining({ viewSize: { width: 390, height: 844 } }),
  )
  mocks.view.setVisible.mockClear()
  await call(event, { action: 'hide', key: 'old-task' })
  expect(mocks.view.setVisible).not.toHaveBeenCalled()
  await call(event, { ...command, key: 'second' })
  expect(mocks.contents.close).toHaveBeenCalledOnce()
  expect(mocks.window.once).toHaveBeenCalledOnce()
  await call(event, { action: 'hide', key: 'second' })
  expect(mocks.view.setVisible).toHaveBeenLastCalledWith(false)
})
it('rejects privileged URL schemes before loading native content', async () => {
  await expect(
    handler()(event, {
      action: 'show',
      key: 'task',
      url: 'file:///etc/passwd',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
    }),
  ).rejects.toThrow('HTTP or HTTPS')
  expect(mocks.contents.loadURL).not.toHaveBeenCalled()
})
