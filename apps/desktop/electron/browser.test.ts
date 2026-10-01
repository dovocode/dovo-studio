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
    once: vi.fn<(event: string, callback: () => void) => void>(),
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
    cdpCreate: vi.fn<typeof import('./browser-cdp').createBrowserCdp>(),
  }
})
vi.mock('./browser-cdp.js', () => ({ createBrowserCdp: mocks.cdpCreate }))
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
it('isolates tabs, clamps their bounds, ignores unknown hides and retains inactive pages', async () => {
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
      partition: 'persist:dovo-preview:default',
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
  expect(mocks.contents.close).not.toHaveBeenCalled()
  expect(mocks.create).toHaveBeenCalledTimes(2)
  await call(event, command)
  expect(mocks.create).toHaveBeenCalledTimes(2)
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

it('replaces the native view when its profile changes, keeping separate persistent partitions', async () => {
  const call = handler()
  const command = {
    action: 'show',
    key: 'task',
    url: 'https://example.com',
    bounds: { x: 0, y: 0, width: 400, height: 300 },
    profileId: 'work',
  }
  await call(event, command)
  await call(event, { ...command, profileId: 'personal' })
  expect(mocks.contents.close).toHaveBeenCalledOnce()
  expect(mocks.create.mock.calls.map(([options]) => options)).toEqual([
    {
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: 'persist:dovo-preview:work',
      },
    },
    {
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: 'persist:dovo-preview:personal',
      },
    },
  ])
})

it('does not re-enable agent access when a pending bridge startup finishes after disabling it', async () => {
  const bridge = {
    register: vi.fn<() => string>(() => 'ws://unused'),
    remove: vi.fn<(id: string) => void>(),
    close: vi.fn<() => Promise<void>>(async () => {}),
  }
  let ready: ((value: typeof bridge) => void) | undefined
  mocks.cdpCreate.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        ready = resolve
      }),
  )
  registerBrowser('/app/index.html', '/tmp/browser-bridge-race')
  const call = mocks.handle.mock.calls.at(-1)?.[1]
  if (!call) throw new Error('Missing handler')
  const command = {
    action: 'show',
    key: 'task',
    taskId: 'task',
    url: 'https://example.com',
    bounds: { x: 0, y: 0, width: 400, height: 300 },
    agentAccess: true,
  }
  const enabling = call(event, command)
  await call(event, { ...command, agentAccess: false })
  if (!ready) throw new Error('Missing bridge startup')
  ready(bridge)
  await enabling
  expect(bridge.register).not.toHaveBeenCalled()
})

it('closes one tab without destroying the remaining tab or reloading it on activation', async () => {
  const call = handler()
  const show = {
    action: 'show',
    key: 'tab-one',
    url: 'https://example.com/one',
    bounds: { x: 0, y: 0, width: 400, height: 300 },
  }
  await call(event, show)
  await call(event, { ...show, key: 'tab-two', url: 'https://example.com/two' })
  expect(mocks.contents.close).not.toHaveBeenCalled()
  await call(event, { action: 'close', key: 'tab-two' })
  expect(mocks.contents.close).toHaveBeenCalledOnce()
  mocks.contents.loadURL.mockClear()
  await call(event, show)
  expect(mocks.create).toHaveBeenCalledTimes(2)
  expect(mocks.contents.loadURL).not.toHaveBeenCalled()
})

it('releases every retained tab when its window closes', async () => {
  const call = handler()
  const show = {
    action: 'show',
    key: 'first-tab',
    url: 'https://example.com/',
    bounds: { x: 0, y: 0, width: 400, height: 300 },
  }
  await call(event, show)
  await call(event, { ...show, key: 'second-tab' })
  const closed = mocks.window.once.mock.calls.find(([name]) => name === 'closed')?.[1]
  expect(closed).toBeDefined()
  closed?.()
  expect(mocks.contents.close).toHaveBeenCalledTimes(2)
})
