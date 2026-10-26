import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
const registrations: Array<ReturnType<typeof registerBrowser>> = []
const mocks = vi.hoisted(() => {
  const contents = {
    setWindowOpenHandler: vi.fn<(...args: unknown[]) => void>(),
    setIgnoreMenuShortcuts: vi.fn<(ignore: boolean) => void>(),
    session: {
      setPermissionRequestHandler: vi.fn<(...args: unknown[]) => void>(),
      setPermissionCheckHandler: vi.fn<(...args: unknown[]) => void>(),
    },
    on: vi.fn<(...args: unknown[]) => void>(),
    close: vi.fn<(...args: unknown[]) => void>(),
    isDestroyed: vi.fn<() => boolean>(() => false),
    loadURL: vi.fn<(url?: string, options?: unknown) => Promise<void>>(async () => {}),
    enableDeviceEmulation: vi.fn<(...args: unknown[]) => void>(),
    disableDeviceEmulation: vi.fn<(...args: unknown[]) => void>(),
    navigationHistory: { canGoBack: () => false, canGoForward: () => false },
    getURL: () => 'https://example.com/',
    getTitle: () => 'Example',
    executeJavaScript: vi.fn<(script: string) => Promise<unknown>>(async () => 'Selected text'),
    capturePage: vi.fn<() => Promise<{ isEmpty: () => boolean; toDataURL: () => string }>>(
      async () => ({
        isEmpty: () => false,
        toDataURL: () => 'data:image/png;base64,c2NyZWVu',
      }),
    ),
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
    isDestroyed: () => false,
    once: vi.fn<(event: string, callback: () => void) => void>(),
    webContents: {
      on: vi.fn<(event: string, callback: (...args: unknown[]) => void) => void>(),
      isDestroyed: () => false,
      focus: vi.fn<() => void>(),
      sendInputEvent: vi.fn<(input: unknown) => void>(),
    },
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
    extensions: {
      host: undefined as undefined | import('./browser-extensions').ExtensionTabHost,
      prepare: vi.fn<(profileId: string) => Promise<void>>(async () => {}),
      ownsUrl: vi.fn<(profileId: string, url: string) => boolean>(() => false),
      addTab: vi.fn<(...args: unknown[]) => void>(),
      selectTab: vi.fn<(...args: unknown[]) => void>(),
      removeTab: vi.fn<(...args: unknown[]) => void>(),
      handle: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
      sync: vi.fn<() => Promise<boolean>>(async () => true),
      dispose: vi.fn<() => Promise<void>>(async () => {}),
    },
    on: vi.fn<(name: string, listener: (event: unknown, ...args: unknown[]) => void) => void>(),
    media: {
      host: undefined as undefined | import('./browser-media').MediaHost,
      attachSession: vi.fn<(...args: unknown[]) => void>(),
      attachTab: vi.fn<(...args: unknown[]) => void>(),
      releaseTab: vi.fn<(...args: unknown[]) => void>(),
      decide: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
      stop: vi.fn<(...args: unknown[]) => void>(),
      snapshot: vi.fn<(windowId: number) => object>(() => ({})),
      reset: vi.fn<() => void>(),
      keepAlive: vi.fn<(...args: unknown[]) => boolean>(() => false),
    },
  }
})
vi.mock('./browser-media.js', () => ({
  createBrowserMedia: (host: import('./browser-media').MediaHost) => {
    mocks.media.host = host
    return mocks.media
  },
}))
vi.mock('./browser-extensions.js', () => ({
  workspacePartition: (profileId: string) => `persist:dovo-browser-workspace:${profileId}`,
  createBrowserExtensions: (host: import('./browser-extensions').ExtensionTabHost) => {
    mocks.extensions.host = host
    return mocks.extensions
  },
}))
vi.mock('./browser-cdp.js', () => ({ createBrowserCdp: mocks.cdpCreate }))
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: () => mocks.window },
  WebContentsView: class {
    constructor(options: unknown) {
      mocks.create(options)
      return mocks.view
    }
  },
  ipcMain: { handle: mocks.handle, on: mocks.on },
  shell: { openExternal: vi.fn<(url: string) => Promise<void>>() },
}))
import { registerBrowser } from './browser'
afterEach(async () => {
  for (const registration of registrations.splice(0)) await registration.dispose()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VITE_DEV_SERVER_URL', '')
})
const frame = { url: 'file:///app/index.html' }
const event = { sender: { mainFrame: frame }, senderFrame: frame }
function handler() {
  registrations.push(registerBrowser('/app/index.html'))
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
it('accepts the Studio index with browser-window and thread hashes, rejecting look-alikes', async () => {
  const call = handler()
  const from = (url: string) => {
    const frame = { url }
    return { sender: { mainFrame: frame }, senderFrame: frame }
  }
  for (const url of [
    'file:///app/index.html#browser-window=0b6f6f0e-5f0c-4d4b-9d43-6f0f8a1c2b3d',
    'file:///app/index.html#thread=task-1',
  ])
    await expect(call(from(url), { action: 'hide', key: 'task' })).resolves.toBeUndefined()
  for (const url of [
    'https://evil.example/app/index.html#browser-window=0b6f6f0e-5f0c-4d4b-9d43-6f0f8a1c2b3d',
    'file:///other/index.html#browser-window=0b6f6f0e-5f0c-4d4b-9d43-6f0f8a1c2b3d',
    'file:///app/index.html?x=1#browser-window=0b6f6f0e-5f0c-4d4b-9d43-6f0f8a1c2b3d',
  ])
    await expect(call(from(url), { action: 'hide', key: 'task' })).rejects.toThrow('Untrusted')
  vi.stubEnv('VITE_DEV_SERVER_URL', 'http://localhost:5173/')
  await expect(
    call(from('http://localhost:5173/#browser-window=0b6f6f0e-5f0c-4d4b-9d43-6f0f8a1c2b3d'), {
      action: 'hide',
      key: 'task',
    }),
  ).resolves.toBeUndefined()
  await expect(
    call(from('http://localhost:5174/#browser-window=0b6f6f0e-5f0c-4d4b-9d43-6f0f8a1c2b3d'), {
      action: 'hide',
      key: 'task',
    }),
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

it('waits for the initial renderer before emulation, including concurrent positioning commands', async () => {
  const call = handler()
  let ready = () => {}
  mocks.contents.loadURL.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        ready = resolve
      }),
  )
  const command = {
    action: 'show',
    key: 'task',
    url: 'http://localhost:3000',
    bounds: { x: 0, y: 0, width: 400, height: 300 },
  }
  const first = call(event, command)
  const second = call(event, { ...command, viewport: { width: 390, height: 844 } })
  expect(mocks.contents.loadURL).toHaveBeenCalledOnce()
  expect(mocks.contents.disableDeviceEmulation).not.toHaveBeenCalled()
  expect(mocks.contents.enableDeviceEmulation).not.toHaveBeenCalled()
  expect(mocks.view.setVisible).not.toHaveBeenCalledWith(true)
  ready()
  await Promise.all([first, second])
  expect(mocks.contents.disableDeviceEmulation).toHaveBeenCalledOnce()
  expect(mocks.contents.enableDeviceEmulation).toHaveBeenCalledOnce()
  expect(mocks.view.setVisible).toHaveBeenLastCalledWith(true)
})

it.each(['hide', 'close'])('keeps a loading preview inactive after %s', async (action) => {
  const call = handler()
  let ready = () => {}
  mocks.contents.loadURL.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        ready = resolve
      }),
  )
  const loading = call(event, {
    action: 'show',
    key: 'task',
    url: 'http://localhost:3000',
    bounds: { x: 0, y: 0, width: 400, height: 300 },
  })
  await call(event, { action, key: 'task' })
  ready()
  await loading
  expect(mocks.contents.disableDeviceEmulation).not.toHaveBeenCalled()
  expect(mocks.view.setVisible).not.toHaveBeenCalledWith(true)
})

it('can retry the same URL after its navigation fails', async () => {
  const call = handler()
  const command = {
    action: 'show',
    key: 'task',
    url: 'http://localhost:3000',
    bounds: { x: 0, y: 0, width: 400, height: 300 },
  }
  mocks.contents.loadURL.mockRejectedValueOnce(new Error('Connection refused'))
  await expect(call(event, command)).rejects.toThrow('Connection refused')
  expect(mocks.contents.disableDeviceEmulation).not.toHaveBeenCalled()
  await call(event, command)
  expect(mocks.contents.loadURL).toHaveBeenCalledTimes(2)
  expect(mocks.contents.disableDeviceEmulation).toHaveBeenCalledOnce()
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
    connected: vi.fn<(id: string) => boolean>(() => false),
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
  registrations.push(registerBrowser('/app/index.html', '/tmp/browser-bridge-race'))
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

it('releases orphaned tabs on renderer reloads and crashes, keeping same-document navigation', async () => {
  const call = handler()
  const show = {
    action: 'show',
    key: 'tab',
    url: 'http://localhost:3000/',
    bounds: { x: 0, y: 0, width: 400, height: 300 },
  }
  await call(event, show)
  await call(event, { ...show, key: 'other' })
  const navigation = mocks.window.webContents.on.mock.calls.find(
    ([name]) => name === 'did-start-navigation',
  )?.[1]
  const crash = mocks.window.webContents.on.mock.calls.find(
    ([name]) => name === 'render-process-gone',
  )?.[1]
  expect(navigation).toBeDefined()
  expect(crash).toBeDefined()
  navigation?.({ isMainFrame: false, isSameDocument: false })
  navigation?.({ isMainFrame: true, isSameDocument: true })
  expect(mocks.contents.close).not.toHaveBeenCalled()
  navigation?.({ isMainFrame: true, isSameDocument: false })
  expect(mocks.contents.close).toHaveBeenCalledTimes(2)
  expect(mocks.window.contentView.removeChildView).toHaveBeenCalledTimes(2)
  await call(event, show)
  expect(mocks.create).toHaveBeenCalledTimes(3)
  crash?.()
  expect(mocks.contents.close).toHaveBeenCalledTimes(3)
})

it('bounds inactive views and expires them while keeping the visible view', async () => {
  vi.useFakeTimers()
  const call = handler()
  const show = {
    action: 'show',
    key: '0',
    url: 'http://localhost:3000',
    bounds: { x: 0, y: 0, width: 400, height: 300 },
  }
  for (let i = 0; i < 9; i++) await call(event, { ...show, key: String(i) })
  expect(mocks.contents.close).toHaveBeenCalledTimes(4)
  await vi.advanceTimersByTimeAsync(5 * 60_000)
  expect(mocks.contents.close).toHaveBeenCalledTimes(8)
  const created = mocks.create.mock.calls.length
  await call(event, { ...show, key: '8' })
  expect(mocks.create).toHaveBeenCalledTimes(created)
  await call(event, show)
  expect(mocks.create).toHaveBeenCalledTimes(created + 1)
})

it('retains hidden workspace call pages beyond the inactive-view limit and timeout', async () => {
  vi.useFakeTimers()
  const call = handler()
  mocks.media.keepAlive.mockReturnValue(true)
  const show = {
    action: 'show',
    key: '0',
    url: 'http://localhost:3000',
    workspaceBrowser: true,
    bounds: { x: 0, y: 0, width: 400, height: 300 },
  }
  for (let i = 0; i < 9; i++) await call(event, { ...show, key: String(i) })
  await vi.advanceTimersByTimeAsync(6 * 60_000)
  expect(mocks.contents.close).not.toHaveBeenCalled()
  mocks.media.keepAlive.mockReturnValue(false)
  await vi.advanceTimersByTimeAsync(30_000)
  expect(mocks.contents.close).toHaveBeenCalledTimes(8)
})

it('keeps hidden views while an agent is connected and evicts them after it disconnects', async () => {
  vi.useFakeTimers()
  let connected = true
  const bridge = {
    connected: () => connected,
    register: () => 'ws://unused',
    remove: vi.fn<(id: string) => void>(),
    close: async () => {},
  }
  mocks.cdpCreate.mockResolvedValueOnce(bridge)
  registrations.push(registerBrowser('/app/index.html', '/tmp/browser-eviction'))
  const call = mocks.handle.mock.calls.at(-1)![1]
  const show = {
    action: 'show',
    key: 'agent',
    taskId: 'agent',
    agentAccess: true,
    url: 'http://localhost:3000',
    bounds: { x: 0, y: 0, width: 400, height: 300 },
  }
  await call(event, show)
  await call(event, { ...show, key: 'other', taskId: 'other', agentAccess: false })
  await vi.advanceTimersByTimeAsync(6 * 60_000)
  expect(mocks.contents.close).not.toHaveBeenCalled()
  connected = false
  await vi.advanceTimersByTimeAsync(30_000)
  expect(mocks.contents.close).toHaveBeenCalledOnce()
  expect(bridge.remove).toHaveBeenCalledWith(JSON.stringify([1, 'agent']))
})

it('captures only the requested browser view and rejects empty images', async () => {
  const call = handler()
  await call(event, {
    action: 'show',
    key: 'capture',
    url: 'https://example.com/',
    bounds: { x: 0, y: 0, width: 400, height: 300 },
  })
  await expect(call(event, { action: 'screenshot', key: 'missing' })).resolves.toBeUndefined()
  expect(mocks.contents.capturePage).not.toHaveBeenCalled()
  await expect(call(event, { action: 'screenshot', key: 'capture' })).resolves.toMatchObject({
    image: 'data:image/png;base64,c2NyZWVu',
  })
  mocks.contents.capturePage.mockResolvedValueOnce({ isEmpty: () => true, toDataURL: () => '' })
  await expect(call(event, { action: 'screenshot', key: 'capture' })).rejects.toThrow('no image')
})

it('reads a bounded literal selection only from the requested browser view', async () => {
  const call = handler()
  await expect(call(event, { action: 'selection', key: 'missing' })).resolves.toBeUndefined()
  expect(mocks.contents.executeJavaScript).not.toHaveBeenCalled()
  await call(event, {
    action: 'show',
    key: 'selection',
    url: 'https://example.com/',
    bounds: { x: 0, y: 0, width: 400, height: 300 },
  })
  await expect(call(event, { action: 'selection', key: 'selection' })).resolves.toMatchObject({
    selection: 'Selected text',
    url: 'https://example.com/',
    title: 'Example',
  })
  mocks.contents.executeJavaScript.mockResolvedValueOnce('x'.repeat(40000))
  const result = await call(event, { action: 'selection', key: 'selection' })
  expect(result).toMatchObject({ selection: 'x'.repeat(32000) })
})

type OpenHandler = (details: {
  url: string
  disposition: string
  features: string
  referrer?: { url: string; policy: string }
  postBody?: { contentType: string; boundary?: string; data: unknown[] }
}) => { action: string; overrideBrowserWindowOptions?: { webPreferences?: object } }
const listener = (name: string) =>
  mocks.contents.on.mock.calls.findLast(([event]) => event === name)?.[1] as
    | ((...args: unknown[]) => void)
    | undefined
const openHandler = () => mocks.contents.setWindowOpenHandler.mock.calls.at(-1)?.[0] as OpenHandler
const workspaceShow = {
  action: 'show',
  key: 'shared',
  url: 'https://example.com/',
  workspaceBrowser: true,
  bounds: { x: 0, y: 0, width: 400, height: 300 },
}
function popupWindow() {
  const popup = {
    close: vi.fn<() => void>(),
    isDestroyed: () => false,
    once: vi.fn<(event: string, callback: () => void) => void>(),
    webContents: {
      on: vi.fn<(event: string, callback: (...args: unknown[]) => void) => void>(),
      setWindowOpenHandler: vi.fn<(handler: OpenHandler) => void>(),
      setIgnoreMenuShortcuts: vi.fn<(ignore: boolean) => void>(),
    },
  }
  return popup
}

it('keeps denying every new window and shortcut for thread-side previews', async () => {
  const call = handler()
  await call(event, { ...workspaceShow, workspaceBrowser: undefined })
  expect(
    openHandler()({ url: 'https://example.com/a', disposition: 'foreground-tab', features: '' }),
  ).toEqual({ action: 'deny' })
  expect(
    openHandler()({
      url: 'https://accounts.example.com/',
      disposition: 'new-window',
      features: 'width=500,height=600',
    }),
  ).toEqual({ action: 'deny' })
  const prevent = vi.fn<() => void>()
  listener('before-input-event')?.(
    { preventDefault: prevent },
    { type: 'keyDown', key: 'l', control: true, meta: false, shift: false, alt: false },
  )
  expect(prevent).not.toHaveBeenCalled()
  expect(mocks.window.webContents.sendInputEvent).not.toHaveBeenCalled()
  const status = await call(event, { action: 'status', key: 'shared' })
  expect(status).not.toHaveProperty('openedLinks')
})

it('queues bounded HTTP(S) new-tab requests for the workspace browser and drains them in status', async () => {
  const call = handler()
  await call(event, workspaceShow)
  const open = openHandler()
  for (const [url, disposition] of [
    ['https://example.com/tab', 'foreground-tab'],
    ['http://192.168.1.20:3000/', 'background-tab'],
    ['https://example.com/shift', 'new-window'],
    ['javascript:alert(1)', 'foreground-tab'],
    ['file:///etc/passwd', 'foreground-tab'],
    ['https://user:secret@example.com/', 'foreground-tab'],
    ['https://example.com/download', 'other'],
  ])
    expect(open({ url, disposition, features: '' })).toEqual({ action: 'deny' })
  await expect(call(event, { action: 'status', key: 'shared' })).resolves.toMatchObject({
    openedLinks: [
      'https://example.com/tab',
      'http://192.168.1.20:3000/',
      'https://example.com/shift',
    ],
  })
  expect(await call(event, { action: 'status', key: 'shared' })).not.toHaveProperty('openedLinks')
  for (let i = 0; i < 30; i++)
    open({ url: `https://example.com/${i}`, disposition: 'foreground-tab', features: '' })
  const status = (await call(event, { action: 'status', key: 'shared' })) as {
    openedLinks: string[]
  }
  expect(status.openedLinks).toHaveLength(20)
  expect(status.openedLinks[0]).toBe('https://example.com/0')
})

it('allows bounded sandboxed OAuth popups that keep the opener and close with their tab', async () => {
  const call = handler()
  await call(event, workspaceShow)
  const open = openHandler()
  const request = {
    url: 'https://accounts.example.com/authorize',
    disposition: 'new-window',
    features: 'popup,width=500,height=600',
  }
  const allowed = open(request)
  expect(allowed).toMatchObject({
    action: 'allow',
    overrideBrowserWindowOptions: {
      parent: mocks.window,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    },
  })
  expect(JSON.stringify(allowed)).not.toContain('partition')
  expect(open({ ...request, url: 'data:text/html,hi' })).toEqual({ action: 'deny' })
  expect(open({ ...request, features: 'noopener,width=500' })).toEqual({ action: 'deny' })
  const created = listener('did-create-window')
  const first = popupWindow()
  const second = popupWindow()
  created?.(first)
  created?.(second)
  expect(open(request)).toEqual({ action: 'deny' })
  const navigate = first.webContents.on.mock.calls.find(([name]) => name === 'will-navigate')?.[1]
  const blocked = vi.fn<() => void>()
  navigate?.({ preventDefault: blocked }, 'file:///etc/passwd')
  navigate?.({ preventDefault: blocked }, 'https://example.com/callback')
  expect(blocked).toHaveBeenCalledOnce()
  const nested = first.webContents.setWindowOpenHandler.mock.calls[0]?.[0]
  expect(
    nested?.({ url: 'https://example.com/help', disposition: 'foreground-tab', features: '' }),
  ).toEqual({ action: 'deny' })
  // A noopener popup cannot report back to its opener, so it becomes an ordinary tab.
  await expect(call(event, { action: 'status', key: 'shared' })).resolves.toMatchObject({
    openedLinks: ['https://accounts.example.com/authorize', 'https://example.com/help'],
  })
  await call(event, { action: 'close', key: 'shared' })
  expect(first.close).toHaveBeenCalledOnce()
  expect(second.close).toHaveBeenCalledOnce()
})

it('closes popups and stops queueing when a view leaves the workspace browser', async () => {
  const call = handler()
  await call(event, workspaceShow)
  const popup = popupWindow()
  listener('did-create-window')?.(popup)
  openHandler()({ url: 'https://example.com/a', disposition: 'foreground-tab', features: '' })
  await call(event, { ...workspaceShow, workspaceBrowser: false })
  expect(popup.close).toHaveBeenCalledOnce()
  expect(await call(event, { action: 'status', key: 'shared' })).not.toHaveProperty('openedLinks')
  const late = popupWindow()
  listener('did-create-window')?.(late)
  expect(late.close).toHaveBeenCalledOnce()
})

it.each([
  ['l', false],
  ['t', false],
  ['w', false],
  ['d', false],
  ['r', false],
  ['n', false],
  ['t', true],
])(
  'forwards primary+%s (shift %s) from the workspace view into the Studio renderer',
  async (key, shift) => {
    const call = handler()
    await call(event, workspaceShow)
    const primary = process.platform === 'darwin' ? 'meta' : 'control'
    const prevent = vi.fn<() => void>()
    listener('before-input-event')?.(
      { preventDefault: prevent },
      {
        type: 'keyDown',
        key: shift ? key.toUpperCase() : key,
        control: primary === 'control',
        meta: primary === 'meta',
        shift,
        alt: false,
      },
    )
    expect(prevent).toHaveBeenCalledOnce()
    expect(mocks.window.webContents.focus).toHaveBeenCalledOnce()
    const modifiers = shift ? [primary, 'shift'] : [primary]
    const keyCode = shift ? key.toUpperCase() : key
    expect(mocks.window.webContents.sendInputEvent.mock.calls).toEqual([
      [{ type: 'keyDown', keyCode, modifiers }],
      [{ type: 'keyUp', keyCode, modifiers }],
    ])
  },
)

it('leaves other page keys, alt chords and auto-repeat replays alone', async () => {
  const call = handler()
  await call(event, workspaceShow)
  const primary = process.platform === 'darwin' ? 'meta' : 'control'
  const input = listener('before-input-event')
  const prevent = vi.fn<() => void>()
  const base = { type: 'keyDown', control: false, meta: false, shift: false, alt: false }
  for (const keys of [
    { key: 'c', [primary]: true },
    { key: 'l', [primary]: true, alt: true },
    { key: 'l', [primary]: true, shift: true },
    { key: 'r', [primary]: true, shift: true },
    { key: 'd', [primary]: true, shift: true },
    { key: 'n', [primary]: true, shift: true },
    { key: 'l' },
    { key: 'l', [primary]: true, type: 'keyUp' },
  ])
    input?.({ preventDefault: prevent }, { ...base, ...keys })
  expect(prevent).not.toHaveBeenCalled()
  input?.({ preventDefault: prevent }, { ...base, key: 'w', [primary]: true, isAutoRepeat: true })
  expect(prevent).toHaveBeenCalledOnce()
  expect(mocks.window.webContents.sendInputEvent).not.toHaveBeenCalled()
})

it('never reads password, hidden or other non-text control selections', async () => {
  const { selectedBrowserText } = await import('@dovo/protocol')
  class TextArea {
    value = 'notes'
    selectionStart = 0
    selectionEnd = 5
  }
  class Input extends TextArea {
    constructor(public type: string) {
      super()
    }
  }
  const page = { activeElement: null as unknown }
  vi.stubGlobal('HTMLTextAreaElement', TextArea)
  vi.stubGlobal('HTMLInputElement', Input)
  vi.stubGlobal('document', page)
  vi.stubGlobal('window', { getSelection: () => ({ toString: () => '••••••' }) })
  try {
    for (const type of ['password', 'hidden', 'number', 'checkbox', 'file', 'color']) {
      page.activeElement = new Input(type)
      expect(selectedBrowserText()).toBe('')
    }
    page.activeElement = new Input('email')
    expect(selectedBrowserText()).toBe('notes')
    page.activeElement = new TextArea()
    expect(selectedBrowserText()).toBe('notes')
  } finally {
    vi.unstubAllGlobals()
  }
})

it('keeps app-menu accelerators away from workspace pages and popups, except editing and Quit', async () => {
  const call = handler()
  const primary = process.platform === 'darwin' ? 'meta' : 'control'
  const key = (input: Record<string, unknown>) => ({
    type: 'keyDown',
    control: false,
    meta: false,
    shift: false,
    alt: false,
    ...input,
  })
  await call(event, workspaceShow)
  expect(mocks.contents.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(true)
  const input = listener('before-input-event')
  for (const [keys, ignored] of [
    [{ key: 'c', [primary]: true }, false],
    [{ key: 'v', [primary]: true }, false],
    [{ key: 'z', [primary]: true, shift: true }, false],
    [{ key: 'q', [primary]: true }, false],
    [{ key: 'i', [primary]: true, shift: true }, true],
    [{ key: 'r', [primary]: true, shift: true }, true],
    [{ key: '=', [primary]: true }, true],
    [{ key: 'c', [primary]: true, alt: true }, true],
  ] as const) {
    input?.({ preventDefault: () => {} }, key(keys))
    expect(mocks.contents.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(ignored)
  }
  const popup = popupWindow()
  listener('did-create-window')?.(popup)
  expect(popup.webContents.setIgnoreMenuShortcuts).toHaveBeenCalledWith(true)
  const popupInput = popup.webContents.on.mock.calls.find(
    ([name]) => name === 'before-input-event',
  )?.[1]
  popupInput?.({}, key({ key: 'c', [primary]: true }))
  expect(popup.webContents.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(false)
  await call(event, { ...workspaceShow, workspaceBrowser: false })
  expect(mocks.contents.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(false)
  mocks.contents.setIgnoreMenuShortcuts.mockClear()
  listener('before-input-event')?.(
    { preventDefault: () => {} },
    key({ key: 'i', [primary]: true, shift: true }),
  )
  expect(mocks.contents.setIgnoreMenuShortcuts).not.toHaveBeenCalled()
})

it('loads validated form POST new-tab requests in the same tab and never replays them as GET', async () => {
  const call = handler()
  await call(event, workspaceShow)
  mocks.contents.loadURL.mockClear()
  const open = openHandler()
  const raw = (text: string) => ({ type: 'rawData', bytes: Buffer.from(text) })
  const referrer = { url: 'https://example.com/form', policy: 'strict-origin-when-cross-origin' }
  const post = {
    url: 'https://example.com/search',
    disposition: 'foreground-tab',
    features: '',
    referrer,
    postBody: { contentType: 'application/x-www-form-urlencoded', data: [raw('q=dovo')] },
  }
  expect(open(post)).toEqual({ action: 'deny' })
  expect(mocks.contents.loadURL).toHaveBeenLastCalledWith('https://example.com/search', {
    postData: [raw('q=dovo')],
    extraHeaders: 'Content-Type: application/x-www-form-urlencoded\n',
    httpReferrer: referrer,
  })
  open({
    ...post,
    disposition: 'new-window',
    features: 'width=400',
    referrer: { url: '', policy: 'no-referrer' },
    postBody: {
      contentType: 'multipart/form-data',
      boundary: '----WebKitFormBoundaryAbC123',
      data: [raw('--x')],
    },
  })
  expect(mocks.contents.loadURL).toHaveBeenLastCalledWith('https://example.com/search', {
    postData: [raw('--x')],
    extraHeaders: 'Content-Type: multipart/form-data; boundary=----WebKitFormBoundaryAbC123\n',
  })
  mocks.contents.loadURL.mockClear()
  for (const rejected of [
    { ...post, url: 'javascript:alert(1)' },
    { ...post, postBody: { ...post.postBody, contentType: 'application/json' } },
    { ...post, postBody: { ...post.postBody, boundary: 'x' } },
    {
      ...post,
      postBody: { contentType: 'multipart/form-data', boundary: 'ok\r\nX-Evil: 1', data: [] },
    },
    { ...post, postBody: { contentType: 'multipart/form-data', data: [] } },
    {
      ...post,
      postBody: { ...post.postBody, data: [{ type: 'file', filePath: '/etc/passwd' }] },
    },
    { ...post, postBody: { ...post.postBody, data: [raw('x'.repeat(1024 * 1024 + 1))] } },
  ]) {
    expect(open(rejected)).toEqual({ action: 'deny' })
    await expect(call(event, { action: 'status', key: 'shared' })).rejects.toThrow(
      'This form could not be opened',
    )
    await expect(call(event, { action: 'status', key: 'shared' })).resolves.toMatchObject({
      url: 'https://example.com/',
    })
  }
  expect(mocks.contents.loadURL).not.toHaveBeenCalled()
  const popup = popupWindow()
  listener('did-create-window')?.(popup)
  popup.webContents.setWindowOpenHandler.mock.calls[0]?.[0](post)
  await expect(call(event, { action: 'status', key: 'shared' })).rejects.toThrow(
    'This form could not be opened',
  )
  expect(await call(event, { action: 'status', key: 'shared' })).not.toHaveProperty('openedLinks')
  await call(event, { ...workspaceShow, workspaceBrowser: false })
  mocks.contents.loadURL.mockClear()
  expect(openHandler()(post)).toEqual({ action: 'deny' })
  expect(mocks.contents.loadURL).not.toHaveBeenCalled()
})

it('keeps shared-browser storage apart from thread previews and recreates views across modes', async () => {
  const call = handler()
  const partition = () =>
    (mocks.create.mock.calls.at(-1)![0] as { webPreferences: { partition: string } }).webPreferences
      .partition
  await call(event, { ...workspaceShow, profileId: 'work' })
  expect(partition()).toBe('persist:dovo-browser-workspace:work')
  await call(event, {
    ...workspaceShow,
    key: 'thread',
    workspaceBrowser: undefined,
    profileId: 'work',
  })
  expect(partition()).toBe('persist:dovo-preview:work')
  expect(mocks.contents.close).not.toHaveBeenCalled()
  await call(event, { ...workspaceShow, workspaceBrowser: false, profileId: 'work' })
  expect(mocks.contents.close).toHaveBeenCalledOnce()
  expect(partition()).toBe('persist:dovo-preview:work')
  await call(event, { ...workspaceShow, profileId: 'work' })
  expect(mocks.contents.close).toHaveBeenCalledTimes(2)
  expect(partition()).toBe('persist:dovo-browser-workspace:work')
  expect(mocks.create).toHaveBeenCalledTimes(4)
})

it('reports a failed form POST load once through status, ignoring aborts by newer navigation', async () => {
  const call = handler()
  await call(event, workspaceShow)
  const post = {
    url: 'https://example.com/search',
    disposition: 'foreground-tab',
    features: '',
    referrer: { url: '', policy: 'no-referrer' },
    postBody: {
      contentType: 'application/x-www-form-urlencoded',
      data: [{ type: 'rawData', bytes: Buffer.from('q=1') }],
    },
  }
  const fail = (code: string) =>
    mocks.contents.loadURL.mockRejectedValueOnce(Object.assign(new Error(code), { code }))
  fail('ERR_ABORTED')
  openHandler()(post)
  await vi.waitFor(() =>
    expect(mocks.contents.loadURL).toHaveBeenCalledWith(post.url, expect.anything()),
  )
  await new Promise((resolve) => setTimeout(resolve))
  await expect(call(event, { action: 'status', key: 'shared' })).resolves.toMatchObject({
    url: 'https://example.com/',
  })
  fail('ERR_CONNECTION_REFUSED')
  openHandler()(post)
  await new Promise((resolve) => setTimeout(resolve))
  const failure = call(event, { action: 'status', key: 'shared' })
  await expect(failure).rejects.toThrow('The form submission could not be loaded.')
  await expect(failure).rejects.not.toThrow('ERR_CONNECTION_REFUSED')
  await expect(call(event, { action: 'status', key: 'shared' })).resolves.toMatchObject({
    url: 'https://example.com/',
  })
})

it('loads profile extensions before shared-browser pages and tracks their tab lifecycle', async () => {
  const call = handler()
  await call(event, { ...workspaceShow, workspaceBrowser: undefined, key: 'thread' })
  expect(mocks.extensions.prepare).not.toHaveBeenCalled()
  expect(mocks.extensions.addTab).not.toHaveBeenCalled()
  await call(event, { ...workspaceShow, profileId: 'work' })
  expect(mocks.extensions.prepare).toHaveBeenCalledWith('work')
  expect(mocks.extensions.prepare.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.create.mock.invocationCallOrder.at(-1)!,
  )
  expect(mocks.extensions.addTab).toHaveBeenCalledWith('work', mocks.contents, mocks.window)
  expect(mocks.extensions.selectTab).toHaveBeenLastCalledWith('work', mocks.contents)
  await call(event, { action: 'close', key: 'thread' })
  expect(mocks.extensions.removeTab).not.toHaveBeenCalled()
  await call(event, { action: 'close', key: 'shared' })
  expect(mocks.extensions.removeTab).toHaveBeenCalledWith('work', mocks.contents)
})

it('keeps browsing when a profile cannot load extensions, and stays hidden if hidden meanwhile', async () => {
  const call = handler()
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.extensions.prepare.mockRejectedValueOnce(new Error('damaged'))
  await call(event, workspaceShow)
  expect(error).toHaveBeenCalledOnce()
  expect(mocks.view.setVisible).toHaveBeenLastCalledWith(true)
  let ready = () => {}
  mocks.extensions.prepare.mockImplementationOnce(
    () => new Promise<void>((resolve) => (ready = resolve)),
  )
  const showing = call(event, { ...workspaceShow, key: 'late' })
  await call(event, { action: 'hide', key: 'late' })
  ready()
  await showing
  expect(mocks.create).toHaveBeenCalledTimes(1)
  error.mockRestore()
})

it('opens extension tabs hidden for adoption and only for web or own extension pages', async () => {
  const call = handler()
  const host = mocks.extensions.host!
  await expect(host.create('work', { url: 'https://example.com/' })).rejects.toThrow(
    'Open this browser profile',
  )
  await call(event, { ...workspaceShow, profileId: 'work' })
  await expect(host.create('work', { url: 'file:///etc/passwd' })).rejects.toThrow(
    'web pages and their own pages',
  )
  const page = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/welcome.html'
  await expect(host.create('work', { url: page })).rejects.toThrow('their own pages')
  mocks.extensions.ownsUrl.mockImplementation((profile, url) => profile === 'work' && url === page)
  mocks.contents.loadURL.mockClear()
  const [contents, window] = await host.create('work', { url: page })
  expect([contents, window]).toEqual([mocks.contents, mocks.window])
  expect(mocks.contents.loadURL).toHaveBeenCalledWith(page)
  const status = (await call(event, { action: 'status', key: 'shared' })) as {
    createdTabs: { key: string; url: string; profileId: string }[]
  }
  expect(status.createdTabs).toEqual([
    { key: expect.stringMatching(/^extension-tab:/), url: page, profileId: 'work' },
  ])
  expect(await call(event, { action: 'status', key: 'shared' })).not.toHaveProperty('createdTabs')
  mocks.contents.loadURL.mockClear()
  const created = mocks.create.mock.calls.length
  await call(event, {
    ...workspaceShow,
    profileId: 'work',
    key: status.createdTabs[0]!.key,
    url: page,
  })
  expect(mocks.create).toHaveBeenCalledTimes(created)
  expect(mocks.contents.loadURL).not.toHaveBeenCalled()
  await expect(
    call(event, { ...workspaceShow, profileId: 'work', key: 'other', url: page }),
  ).rejects.toThrow('HTTP or HTTPS')
  const guard = listener('will-navigate')
  const prevent = vi.fn<() => void>()
  guard?.({ preventDefault: prevent }, page)
  guard?.({ preventDefault: prevent }, 'chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba/x.html')
  expect(prevent).toHaveBeenCalledOnce()
})

it('closes tabs an extension removes and reports them once to the window', async () => {
  const call = handler()
  const host = mocks.extensions.host!
  await call(event, { ...workspaceShow, profileId: 'work' })
  host.close(mocks.contents as never)
  expect(mocks.contents.close).toHaveBeenCalledOnce()
  await call(event, { ...workspaceShow, key: 'next', profileId: 'work' })
  await expect(call(event, { action: 'status', key: 'next' })).resolves.toMatchObject({
    closedTabs: ['shared'],
  })
  expect(await call(event, { action: 'status', key: 'next' })).not.toHaveProperty('closedTabs')
})

it('finds only shared-browser tabs of the requested profile for extension popups', async () => {
  const call = handler()
  const host = mocks.extensions.host!
  await call(event, { ...workspaceShow, profileId: 'work' })
  await call(event, { ...workspaceShow, key: 'thread', workspaceBrowser: undefined })
  const window = mocks.window as never
  expect(host.find(window, 'shared', 'work')).toBe(mocks.contents)
  expect(host.find(window, 'shared', 'personal')).toBeUndefined()
  expect(host.find(window, 'thread', 'default')).toBeUndefined()
  expect(host.find(window, 'missing', 'work')).toBeUndefined()
})

it('accepts extension commands only from trusted Studio renderers', async () => {
  handler()
  const extensions = mocks.handle.mock.calls.find(([name]) => name === 'browser:extensions')?.[1]
  const other = { url: 'https://example.com' }
  await expect(
    extensions?.({ sender: { mainFrame: other }, senderFrame: other }, { action: 'list' }),
  ).rejects.toThrow('Untrusted')
  expect(mocks.extensions.handle).not.toHaveBeenCalled()
  const command = { action: 'list', profileId: 'work' }
  await extensions?.(event, command)
  expect(mocks.extensions.handle).toHaveBeenCalledWith(mocks.window, command)
})

it('stops extensions and closes shared-browser pages when a trusted settings write turns Browser off', async () => {
  const call = handler()
  const write = mocks.on.mock.calls.find(([name]) => name === 'app:settings-write')?.[1]
  await call(event, { ...workspaceShow, key: 'thread', workspaceBrowser: undefined })
  await call(event, { ...workspaceShow, profileId: 'work' })
  const tick = () => new Promise((resolve) => setImmediate(resolve))
  const other = { url: 'https://example.com' }
  write?.({ sender: { mainFrame: other }, senderFrame: other })
  await tick()
  expect(mocks.extensions.sync).not.toHaveBeenCalled()
  write?.(event)
  await tick()
  expect(mocks.extensions.sync).toHaveBeenCalledOnce()
  expect(mocks.contents.close).not.toHaveBeenCalled()
  mocks.extensions.sync.mockResolvedValueOnce(false)
  write?.(event)
  await tick()
  await tick()
  expect(mocks.extensions.removeTab).toHaveBeenCalledWith('work', mocks.contents)
  expect(mocks.contents.close).toHaveBeenCalledOnce()
  await expect(call(event, { action: 'status', key: 'shared' })).resolves.toBeUndefined()
  await expect(call(event, { action: 'status', key: 'thread' })).resolves.toMatchObject({
    url: 'https://example.com/',
  })
})

it('unloads every profile extension when the browser bridge is disposed', async () => {
  handler()
  await registrations.at(-1)!.dispose()
  registrations.pop()
  expect(mocks.extensions.dispose).toHaveBeenCalledOnce()
})

it('gives up on a hung page selection after 3 seconds without retrying', async () => {
  const call = handler()
  await call(event, { ...workspaceShow, key: 'hung' })
  vi.useFakeTimers()
  let late = (_error: Error) => {}
  mocks.contents.executeJavaScript.mockImplementationOnce(
    () => new Promise((_resolve, reject) => (late = reject)),
  )
  let outcome: unknown = 'pending'
  const reading = call(event, { action: 'selection', key: 'hung' }).then(
    () => (outcome = 'resolved'),
    (error: Error) => (outcome = error.message),
  )
  await vi.advanceTimersByTimeAsync(2999)
  expect(outcome).toBe('pending')
  await vi.advanceTimersByTimeAsync(1)
  await reading
  expect(outcome).toBe('The page did not return its selection within 3 seconds.')
  expect(mocks.contents.executeJavaScript).toHaveBeenCalledOnce()
  late(new Error('page destroyed'))
  await expect(call(event, { action: 'selection', key: 'hung' })).resolves.toMatchObject({
    selection: 'Selected text',
  })
  expect(vi.getTimerCount()).toBe(0)
})

it('names extension tabs in the source profile scope so the pane adopts them as ordinary tabs', async () => {
  const call = handler()
  const host = mocks.extensions.host!
  await call(event, { ...workspaceShow, key: 'studio:browser:tab-1', profileId: 'work' })
  await call(event, { ...workspaceShow, key: 'studio:browser:tab-2', profileId: 'personal' })
  await host.create('work', { url: 'https://example.com/work' })
  await host.create('personal', { url: 'https://example.com/personal' })
  const status = (await call(event, { action: 'status', key: 'studio:browser:tab-2' })) as {
    createdTabs: { key: string; url: string; profileId: string }[]
  }
  const id = /^studio:browser:[0-9a-f-]{36}$/
  expect(status.createdTabs).toEqual([
    { key: expect.stringMatching(id), url: 'https://example.com/work', profileId: 'work' },
    { key: expect.stringMatching(id), url: 'https://example.com/personal', profileId: 'personal' },
  ])
  const [work] = status.createdTabs
  mocks.contents.loadURL.mockClear()
  const created = mocks.create.mock.calls.length
  await call(event, { ...workspaceShow, key: work!.key, url: work!.url, profileId: 'work' })
  expect(mocks.create).toHaveBeenCalledTimes(created)
  expect(mocks.contents.loadURL).not.toHaveBeenCalled()
})

it('still reports window tab events when an extension closed the very tab being polled', async () => {
  const call = handler()
  const host = mocks.extensions.host!
  await call(event, { ...workspaceShow, profileId: 'work' })
  await expect(call(event, { action: 'status', key: 'missing' })).resolves.toBeUndefined()
  host.close(mocks.contents as never)
  await expect(call(event, { action: 'status', key: 'shared' })).resolves.toEqual({
    url: '',
    back: false,
    forward: false,
    closedTabs: ['shared'],
  })
  await expect(call(event, { action: 'status', key: 'shared' })).resolves.toBeUndefined()
  await expect(call(event, { action: 'reload', key: 'shared' })).resolves.toBeUndefined()
})

it('gives shared-browser sessions media handling and keeps thread previews denying everything', async () => {
  const call = handler()
  await call(event, { ...workspaceShow, key: 'thread', workspaceBrowser: undefined })
  expect(mocks.media.attachSession).not.toHaveBeenCalled()
  const deny = mocks.contents.session.setPermissionRequestHandler.mock.calls.at(-1)?.[0] as (
    ...args: unknown[]
  ) => void
  const answer = vi.fn<(allowed: boolean) => void>()
  deny({}, 'media', answer)
  expect(answer).toHaveBeenCalledWith(false)
  mocks.contents.session.setPermissionRequestHandler.mockClear()
  await call(event, { ...workspaceShow, profileId: 'work' })
  expect(mocks.media.attachSession).toHaveBeenCalledWith(mocks.contents.session, 'work')
  expect(mocks.media.attachTab).toHaveBeenCalledWith(mocks.contents)
  expect(mocks.contents.session.setPermissionRequestHandler).not.toHaveBeenCalled()
  const host = mocks.media.host!
  expect(host.tabFor({ id: (mocks.contents as { id?: number }).id } as never)).toMatchObject({
    key: 'shared',
    windowId: 1,
    profileId: 'work',
  })
  expect(host.tabs(1, 'work').map((tab) => tab.key)).toEqual(['shared'])
  expect(host.tabs(1, 'personal')).toEqual([])
  await call(event, { action: 'close', key: 'shared' })
  expect(mocks.media.releaseTab).toHaveBeenCalledWith(mocks.contents)
})

it('routes media answers, stop requests and window media status through trusted IPC', async () => {
  const call = handler()
  await call(event, { ...workspaceShow, profileId: 'work' })
  const requestId = '0b6f6f0e-5f0c-4d4b-9d43-6f0f8a1c2b3d'
  const answer = {
    action: 'media',
    key: 'shared',
    requestId,
    decision: 'allow',
    source: 'shared',
    audio: true,
  }
  await call(event, answer)
  expect(mocks.media.decide).toHaveBeenCalledWith(1, answer)
  const stop = { action: 'stop-capture', key: 'shared', captureId: requestId }
  await call(event, stop)
  expect(mocks.media.stop).toHaveBeenCalledWith(1, stop)
  const snapshot = {
    mediaRequests: [{ id: requestId, kind: 'display' }],
    captures: [{ id: requestId, state: 'active' }],
  }
  mocks.media.snapshot.mockReturnValue(snapshot)
  await expect(call(event, { action: 'media-status', key: 'anything' })).resolves.toEqual({
    url: '',
    back: false,
    forward: false,
    ...snapshot,
  })
  await expect(call(event, { action: 'status', key: 'shared' })).resolves.toMatchObject(snapshot)
  await expect(call(event, { action: 'status', key: 'gone' })).resolves.toMatchObject(snapshot)
  mocks.media.snapshot.mockReturnValue({})
  mocks.media.decide.mockRejectedValueOnce(new Error('This media request is no longer waiting'))
  await expect(call(event, answer)).rejects.toThrow('no longer waiting')
})

it('denies pending media requests and forgets camera answers when Browser turns off', async () => {
  handler()
  const write = mocks.on.mock.calls.find(([name]) => name === 'app:settings-write')?.[1]
  mocks.extensions.sync.mockResolvedValueOnce(false)
  write?.(event)
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  expect(mocks.media.reset).toHaveBeenCalledOnce()
})

it('serves global media status to a trusted window without a tab and never drains tab events', async () => {
  const call = handler()
  const host = mocks.extensions.host!
  await call(event, { ...workspaceShow, profileId: 'work' })
  await host.create('work', { url: 'https://example.com/opened' })
  mocks.media.snapshot.mockReturnValue({ captures: [{ id: 'c', state: 'active' }] })
  await expect(call(event, { action: 'media-status', key: 'studio-media' })).resolves.toEqual({
    url: '',
    back: false,
    forward: false,
    captures: [{ id: 'c', state: 'active' }],
  })
  mocks.media.snapshot.mockReturnValue({})
  await expect(call(event, { action: 'media-status', key: 'studio-media' })).resolves.toEqual({
    url: '',
    back: false,
    forward: false,
  })
  await expect(call(event, { action: 'status', key: 'shared' })).resolves.toMatchObject({
    createdTabs: [expect.objectContaining({ url: 'https://example.com/opened' })],
  })
  const other = { url: 'https://example.com' }
  await expect(
    call(
      { sender: { mainFrame: other }, senderFrame: other },
      { action: 'media-status', key: 'studio-media' },
    ),
  ).rejects.toThrow('Untrusted')
})
