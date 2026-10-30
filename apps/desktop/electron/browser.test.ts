import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const visibilityDirectory = mkdtempSync(join(tmpdir(), 'dovo-browser-unit-'))
afterAll(() => rmSync(visibilityDirectory, { recursive: true, force: true }))
const registrations: Array<ReturnType<typeof registerBrowser>> = []
const mocks = vi.hoisted(() => {
  const contents = {
    id: 42,
    mainFrame: {
      framesInSubtree: [] as Array<Pick<Electron.WebFrameMain, 'send' | 'detached'>>,
      processId: 10,
      routingId: 1,
      url: 'https://example.com/',
      executeJavaScript: vi.fn<(script: string) => Promise<void>>(async () => {}),
    },
    beginFrameSubscription:
      vi.fn<
        (
          dirtyOnly: boolean,
          listener: (image: Pick<Electron.NativeImage, 'isEmpty' | 'toJPEG'>) => void,
        ) => void
      >(),
    endFrameSubscription: vi.fn<() => void>(),
    reload: vi.fn<() => void>(),
    copyImageAt: vi.fn<(x: number, y: number) => void>(),
    downloadURL: vi.fn<(url: string) => void>(),
    stop: vi.fn<() => void>(),
    send: vi.fn<(...args: unknown[]) => void>(),
    getUserAgent: () =>
      'Mozilla/5.0 Chrome/148.0.0.0 Safari/537.36 DovoStudio/0.0.9 Electron/45.0.0',
    setUserAgent: vi.fn<(value: string) => void>(),
    getZoomFactor: vi.fn<() => number>(() => 1),
    setZoomFactor: vi.fn<(factor: number) => void>(),
    setBackgroundThrottling: vi.fn<(value: boolean) => void>(),
    isCurrentlyAudible: vi.fn<() => boolean>(() => false),
    isAudioMuted: vi.fn<() => boolean>(() => false),
    setAudioMuted: vi.fn<(muted: boolean) => void>(),
    setWindowOpenHandler: vi.fn<(...args: unknown[]) => void>(),
    setIgnoreMenuShortcuts: vi.fn<(ignore: boolean) => void>(),
    session: {
      on: vi.fn<(...args: unknown[]) => void>(),
      off: vi.fn<(...args: unknown[]) => void>(),
      registerPreloadScript: vi.fn<(...args: unknown[]) => string>(() => 'visibility'),
      unregisterPreloadScript: vi.fn<(...args: unknown[]) => void>(),
      webRequest: { onBeforeRequest: vi.fn<(...args: unknown[]) => void>() },
      fetch: vi.fn<(url: string, options?: unknown) => Promise<Response>>(),
      setUserAgent: vi.fn<(value: string) => void>(),
      setPermissionRequestHandler: vi.fn<(...args: unknown[]) => void>(),
      setPermissionCheckHandler: vi.fn<(...args: unknown[]) => void>(),
      clearStorageData: vi.fn<() => Promise<void>>(async () => {}),
      clearCache: vi.fn<() => Promise<void>>(async () => {}),
      closeAllConnections: vi.fn<() => Promise<void>>(async () => {}),
    },
    on: vi.fn<(...args: unknown[]) => void>(),
    ipc: {
      on: vi.fn<(...args: unknown[]) => void>(),
      handle: vi.fn<(...args: unknown[]) => void>(),
    },
    once: vi.fn<(...args: unknown[]) => void>(),
    removeListener: vi.fn<(...args: unknown[]) => void>(),
    close: vi.fn<(...args: unknown[]) => void>(),
    isDestroyed: vi.fn<() => boolean>(() => false),
    isFocused: vi.fn<() => boolean>(() => false),
    focus: vi.fn<() => void>(),
    loadURL: vi.fn<(url?: string, options?: unknown) => Promise<void>>(async () => {}),
    enableDeviceEmulation: vi.fn<(...args: unknown[]) => void>(),
    disableDeviceEmulation: vi.fn<(...args: unknown[]) => void>(),
    navigationHistory: { canGoBack: () => false, canGoForward: () => false },
    getURL: () => 'https://example.com/',
    getTitle: () => 'Example',
    insertCSS: vi.fn<(...args: unknown[]) => Promise<string>>().mockResolvedValue('drag-guard'),
    executeJavaScriptInIsolatedWorld: vi
      .fn<(...args: unknown[]) => Promise<void>>()
      .mockResolvedValue(),
    executeJavaScript: vi.fn<(script: string) => Promise<unknown>>(async () => 'Selected text'),
    capturePage: vi.fn<
      (...args: unknown[]) => Promise<{ isEmpty: () => boolean; toDataURL: () => string }>
    >(async () => ({
      isEmpty: () => false,
      toDataURL: () => 'data:image/png;base64,c2NyZWVu',
    })),
  }
  const view = {
    webContents: contents,
    getVisible: vi.fn<() => boolean>(() => true),
    getBounds: vi.fn<() => Electron.Rectangle>(() => ({ x: 0, y: 40, width: 900, height: 660 })),
    setVisible: vi.fn<(...args: unknown[]) => void>(),
    setBounds: vi.fn<(...args: unknown[]) => void>(),
  }
  const window = {
    id: 1,
    contentView: {
      children: [] as unknown[],
      on: vi.fn<(...args: unknown[]) => void>(),
      getBounds: vi.fn<() => Electron.Rectangle>(() => ({ x: 0, y: 0, width: 900, height: 700 })),
      addChildView: vi.fn<(...args: unknown[]) => void>(),
      removeChildView: vi.fn<(...args: unknown[]) => void>(),
    },
    getContentSize: () => [900, 700],
    getTitle: () => 'Studio',
    isMinimized: () => false,
    isVisible: () => true,
    isFullScreen: vi.fn<() => boolean>(() => false),
    setFullScreen: vi.fn<(value: boolean) => void>(),
    restore: vi.fn<() => void>(),
    show: vi.fn<() => void>(),
    focus: vi.fn<() => void>(),
    isDestroyed: () => false,
    on: vi.fn<(...args: unknown[]) => void>(),
    once: vi.fn<(event: string, callback: () => void) => void>(),
    webContents: {
      on: vi.fn<(event: string, callback: (...args: unknown[]) => void) => void>(),
      isDestroyed: () => false,
      getZoomFactor: vi.fn<() => number>(() => 1),
      send: vi.fn<(...args: unknown[]) => void>(),
      focus: vi.fn<() => void>(),
      sendInputEvent: vi.fn<(input: unknown) => void>(),
    },
  }
  return {
    menu: vi.fn<(items: import('electron').MenuItemConstructorOptions[]) => { popup: () => void }>(
      () => ({ popup: () => {} }),
    ),
    clipboard: vi.fn<(value: string) => void>(),
    view,
    window,
    windowFor: undefined as undefined | typeof window,
    automaticPip: false,
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
    pipWindow: vi.fn<typeof import('./browser-document-pip-controls').createDocumentPipWindow>(),
    linkProfile: vi.fn<(source: string, url: string) => string | undefined>(() => undefined),
    media: {
      host: undefined as undefined | import('./browser-media').MediaHost,
      attachSession: vi.fn<(...args: unknown[]) => void>(),
      attachTab: vi.fn<(...args: unknown[]) => void>(),
      releaseTab: vi.fn<(...args: unknown[]) => void>(),
      moveTab: vi.fn<(...args: unknown[]) => void>(),
      revokeSite: vi.fn<(...args: unknown[]) => void>(),
      decide: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
      stop: vi.fn<(...args: unknown[]) => void>(),
      snapshot: vi.fn<(windowId: number) => object>(() => ({})),
      reset: vi.fn<() => void>(),
      releaseWindow: vi.fn<(...args: unknown[]) => void>(),
      setThreadSources: vi.fn<(...args: unknown[]) => void>(),
      setRemoteSources: vi.fn<(...args: unknown[]) => void>(),
      keepAlive: vi.fn<(...args: unknown[]) => boolean>(() => false),
    },
  }
})
vi.mock('./browser-document-pip-controls.js', () => ({
  DOCUMENT_PIP_HEADER_HEIGHT: 36,
  createDocumentPipWindow: mocks.pipWindow,
}))
vi.mock('./browser-permissions.js', () => ({
  forgetPrivateBrowserPermissions: () => {},
  browserPermissions: () => ({
    site: () => ({ permissions: { 'automatic-pip': mocks.automaticPip ? 'allow' : 'block' } }),
    notification: () => undefined,
    setNotification: vi.fn<(origin: string, allow: boolean) => void>(),
  }),
}))
vi.mock('./browser-media.js', () => ({
  createBrowserMedia: (host: import('./browser-media').MediaHost) => {
    mocks.media.host = host
    return mocks.media
  },
}))
vi.mock('./browser-extensions.js', async () => {
  const { isPrivateBrowserProfile } = await import('@dovo/protocol')
  return {
    workspacePartition: (profileId: string) =>
      `${isPrivateBrowserProfile(profileId) ? '' : 'persist:'}dovo-browser-workspace:${profileId}`,
    createBrowserExtensions: (host: import('./browser-extensions').ExtensionTabHost) => {
      mocks.extensions.host = host
      return mocks.extensions
    },
  }
})
vi.mock('./browser-cdp.js', () => ({ createBrowserCdp: mocks.cdpCreate }))
vi.mock('./browser-language.js', () => ({
  websiteCustomization: () => '',
  websiteLinkProfile: mocks.linkProfile,
  configureBrowserLanguage: (
    session: typeof mocks.contents.session,
    _profileId: string,
    userAgent: string,
  ) => session.setUserAgent(userAgent),
}))
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => visibilityDirectory },
  Menu: { buildFromTemplate: mocks.menu },
  clipboard: { writeText: mocks.clipboard },
  BrowserWindow: { fromWebContents: () => mocks.windowFor ?? mocks.window },
  WebContentsView: class {
    constructor(options: unknown) {
      mocks.create(options)
      return mocks.view
    }
  },
  ipcMain: {
    handle: mocks.handle,
    on: mocks.on,
    removeListener: vi.fn<(name: string, listener: unknown) => void>(),
  },
  shell: { openExternal: vi.fn<(url: string) => Promise<void>>() },
}))
import { registerBrowser } from './browser'
afterEach(async () => {
  for (const registration of registrations.splice(0)) await registration.dispose()
  vi.unstubAllEnvs()
  vi.useRealTimers()
  vi.restoreAllMocks()
})
beforeEach(() => {
  vi.clearAllMocks()
  mocks.linkProfile.mockReturnValue(undefined)
  mocks.windowFor = undefined
  mocks.automaticPip = false
  mocks.contents.isDestroyed.mockReturnValue(false)
  mocks.contents.isCurrentlyAudible.mockReturnValue(false)
  mocks.contents.isAudioMuted.mockReturnValue(false)
  mocks.contents.setAudioMuted.mockImplementation((muted) =>
    mocks.contents.isAudioMuted.mockReturnValue(muted),
  )
  mocks.view.getVisible.mockReturnValue(true)
  mocks.view.setVisible.mockImplementation((visible) => {
    mocks.view.getVisible.mockReturnValue(Boolean(visible))
  })
  mocks.window.contentView.children = []
  mocks.window.contentView.addChildView.mockImplementation((view) => {
    mocks.window.contentView.children = [
      ...mocks.window.contentView.children.filter((child) => child !== view),
      view,
    ]
  })
  mocks.media.snapshot.mockReturnValue({})
  mocks.media.keepAlive.mockReturnValue(false)
  mocks.window.isFullScreen.mockReturnValue(false)
  mocks.window.contentView.getBounds.mockReturnValue({ x: 0, y: 0, width: 900, height: 700 })
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
      nodeIntegrationInSubFrames: true,
      disableBlinkFeatures: 'DocumentPictureInPictureAPI',
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

it('positions native content in window coordinates when Studio is zoomed', async () => {
  const call = handler()
  mocks.window.webContents.getZoomFactor.mockReturnValueOnce(1.25)
  await call(event, {
    action: 'show',
    key: 'zoomed',
    url: 'http://localhost:3000',
    bounds: { x: 100, y: 40, width: 400, height: 300 },
  })
  expect(mocks.view.setBounds).toHaveBeenLastCalledWith({ x: 125, y: 50, width: 500, height: 375 })
})

it.each(['hide', 'close'])(
  'returns keyboard focus to Studio when a focused page is %s',
  async (action) => {
    const call = handler()
    await call(event, {
      action: 'show',
      key: 'focused',
      url: 'http://localhost:3000',
      bounds: { x: 0, y: 40, width: 400, height: 300 },
    })
    mocks.contents.isFocused.mockReturnValueOnce(true)
    await call(event, { action, key: 'focused' })
    expect(mocks.window.webContents.focus).toHaveBeenCalledOnce()
  },
)

it('keeps a redirected or reloaded page visible when its original navigation is aborted', async () => {
  const call = handler()
  mocks.contents.loadURL.mockRejectedValueOnce(
    Object.assign(new Error('Navigation replaced'), { code: 'ERR_ABORTED' }),
  )
  const command = {
    action: 'show',
    key: 'redirected',
    url: 'http://localhost:3000',
    bounds: { x: 0, y: 40, width: 400, height: 300 },
  }
  await expect(call(event, command)).resolves.toBeUndefined()
  expect(mocks.view.setVisible).toHaveBeenLastCalledWith(true)
  await call(event, command)
  expect(mocks.contents.loadURL).toHaveBeenCalledOnce()
})

it.each(['pointer', 'escape', 'click', 'typing', 'dialog'] as const)(
  'restores page focus after a passive tooltip unless Studio receives input: %s',
  async (dismissal) => {
    const call = handler()
    const command = {
      action: 'show',
      key: 'passive',
      url: 'http://localhost:3000',
      bounds: { x: 0, y: 40, width: 400, height: 300 },
    }
    await call(event, command)
    mocks.contents.isFocused.mockReturnValueOnce(true).mockReturnValueOnce(true)
    await call(event, { action: 'hide', key: 'passive', preserveFocus: true })
    expect(mocks.view.setVisible).toHaveBeenLastCalledWith(false)
    expect(mocks.window.webContents.focus).toHaveBeenCalledOnce()
    const input = (name: string, value: unknown) => {
      const callback = mocks.window.webContents.on.mock.calls.find(([event]) => event === name)?.[1]
      if (!callback) throw new Error('Missing Studio input listener')
      callback({}, value)
    }
    if (dismissal === 'escape') input('before-input-event', { type: 'keyDown', key: 'Escape' })
    if (dismissal === 'click') input('before-mouse-event', { type: 'mouseDown' })
    if (dismissal === 'typing') input('before-input-event', { type: 'keyDown', key: 'a' })
    if (dismissal === 'dialog') await call(event, { action: 'hide', key: 'passive' })
    await call(event, command)
    expect(mocks.view.setVisible).toHaveBeenLastCalledWith(true)
    expect(mocks.contents.focus).toHaveBeenCalledTimes(
      ['pointer', 'escape'].includes(dismissal) ? 1 : 0,
    )
  },
)

it('shows and emulates a DOM-ready page while subresources are still loading', async () => {
  const call = handler()
  let finish = () => {}
  mocks.contents.loadURL.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const command = {
    action: 'show',
    key: 'slow',
    url: 'http://localhost:3000',
    bounds: { x: 0, y: 0, width: 400, height: 300 },
  }
  const first = call(event, command)
  const second = call(event, { ...command, viewport: { width: 390, height: 844 } })
  expect(mocks.view.setVisible).not.toHaveBeenCalledWith(true)
  const ready = mocks.contents.on.mock.calls.findLast(([name]) => name === 'dom-ready')?.[1]
  if (typeof ready !== 'function') throw new Error('Missing renderer readiness listener')
  ready()
  await Promise.all([first, second])
  expect(mocks.view.setVisible).toHaveBeenLastCalledWith(true)
  expect(mocks.contents.enableDeviceEmulation).toHaveBeenCalledOnce()
  expect(mocks.contents.disableDeviceEmulation).not.toHaveBeenCalled()
  expect(mocks.contents.removeListener).toHaveBeenCalledWith('dom-ready', ready)
  finish()
})

it('reports navigation failures that arrive after the page was shown at DOM readiness', async () => {
  const call = handler()
  let fail = (_error: Error) => {}
  mocks.contents.loadURL.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, reject) => {
        fail = reject
      }),
  )
  const showing = call(event, {
    action: 'show',
    key: 'late-failure',
    url: 'http://localhost:3000',
    bounds: { x: 0, y: 0, width: 400, height: 300 },
  })
  const ready = mocks.contents.on.mock.calls.findLast(([name]) => name === 'dom-ready')?.[1]
  if (typeof ready !== 'function') throw new Error('Missing renderer readiness listener')
  ready()
  await showing
  fail(new Error('Renderer navigation failed'))
  await Promise.resolve()
  await expect(call(event, { action: 'status', key: 'late-failure' })).rejects.toThrow(
    'Renderer navigation failed',
  )
})

it('stops waiting for renderer readiness when a loading page is destroyed', async () => {
  const call = handler()
  let finish = () => {}
  mocks.contents.loadURL.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const showing = call(event, {
    action: 'show',
    key: 'destroyed-loading',
    url: 'http://localhost:3000',
    bounds: { x: 0, y: 0, width: 400, height: 300 },
  })
  const destroyed = mocks.contents.on.mock.calls.findLast(([name]) => name === 'destroyed')?.[1]
  if (typeof destroyed !== 'function') throw new Error('Missing renderer destruction listener')
  destroyed()
  await expect(showing).rejects.toThrow('The browser page was closed.')
  expect(mocks.view.setVisible).not.toHaveBeenCalledWith(true)
  finish()
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
  expect(mocks.contents.disableDeviceEmulation).not.toHaveBeenCalled()
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

it('ignores an older show when the same tab is restored before profile preparation finishes', async () => {
  const call = handler()
  let ready = () => {}
  mocks.extensions.prepare.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        ready = resolve
      }),
  )
  const command = {
    action: 'show',
    key: 'shared',
    workspaceBrowser: true,
    url: 'http://localhost:3000',
    bounds: { x: 0, y: 0, width: 400, height: 300 },
  }
  const first = call(event, command)
  await call(event, { action: 'hide', key: 'shared' })
  const bounds = { x: 100, y: 100, width: 600, height: 500 }
  await call(event, { ...command, bounds, viewport: { width: 390, height: 844 } })
  mocks.view.setBounds.mockClear()
  mocks.contents.disableDeviceEmulation.mockClear()
  ready()
  await first
  expect(mocks.view.setBounds).not.toHaveBeenCalled()
  expect(mocks.contents.disableDeviceEmulation).not.toHaveBeenCalled()
  expect(mocks.view.setVisible).toHaveBeenLastCalledWith(true)
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
  expect(mocks.contents.disableDeviceEmulation).not.toHaveBeenCalled()
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
        nodeIntegrationInSubFrames: true,
        disableBlinkFeatures: 'DocumentPictureInPictureAPI',
        partition: 'persist:dovo-preview:work',
      },
    },
    {
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: true,
        disableBlinkFeatures: 'DocumentPictureInPictureAPI',
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
  expect(mocks.contents.capturePage).toHaveBeenCalledWith(undefined, { stayHidden: true })
  mocks.contents.capturePage.mockResolvedValueOnce({ isEmpty: () => true, toDataURL: () => '' })
  await expect(call(event, { action: 'screenshot', key: 'capture' })).rejects.toThrow('no image')
})

it('streams hidden pages only to their owner and restores throttling on unsubscribe and close', async () => {
  const call = handler()
  await call(event, {
    action: 'show',
    key: 'live',
    url: 'https://example.com/',
    workspaceBrowser: true,
    bounds: { x: 0, y: 40, width: 400, height: 300 },
  })
  await call(event, { action: 'watch-frames', key: 'missing', enabled: true })
  expect(mocks.contents.beginFrameSubscription).not.toHaveBeenCalled()
  await call(event, { action: 'watch-frames', key: 'live', enabled: true })
  await call(event, { action: 'watch-frames', key: 'live', enabled: true })
  expect(mocks.contents.beginFrameSubscription).toHaveBeenCalledOnce()
  await call(event, { action: 'hide', key: 'live', occluded: true })
  expect(mocks.contents.setBackgroundThrottling).toHaveBeenLastCalledWith(false)
  expect(mocks.contents.send).toHaveBeenLastCalledWith('browser:visibility', true)
  const deliver = mocks.contents.beginFrameSubscription.mock.calls[0]![1]
  const image = { isEmpty: () => false, toJPEG: () => Buffer.from('frame') }
  mocks.window.webContents.send.mockClear()
  deliver(image)
  deliver(image)
  expect(mocks.window.webContents.send).toHaveBeenCalledExactlyOnceWith('browser:frame', {
    key: 'live',
    url: 'https://example.com/',
    image: 'data:image/jpeg;base64,ZnJhbWU=',
  })
  await call(event, { action: 'watch-frames', key: 'live', enabled: false })
  expect(mocks.contents.endFrameSubscription).toHaveBeenCalledOnce()
  expect(mocks.contents.setBackgroundThrottling).toHaveBeenLastCalledWith(true)
  expect(mocks.contents.send).toHaveBeenLastCalledWith('browser:visibility', true)
  deliver(image)
  expect(mocks.window.webContents.send).toHaveBeenCalledTimes(1)
  await call(event, { action: 'watch-frames', key: 'live', enabled: true })
  await call(event, { action: 'close', key: 'live' })
  expect(mocks.contents.endFrameSubscription).toHaveBeenCalledTimes(2)
})

it('activates automatic PiP when leaving an occluded tab even with a live preview subscription', async () => {
  const call = handler()
  await call(event, workspaceShow)
  mocks.automaticPip = true
  const allowed = mocks.contents.ipc.handle.mock.calls.find(
    ([name]) => name === 'browser:document-pip-auto',
  )?.[1]
  if (typeof allowed !== 'function') throw new Error('Missing automatic PiP check')
  const mainFrame = { senderFrame: mocks.contents.mainFrame }
  await call(event, { action: 'watch-frames', key: 'shared', enabled: true })
  await call(event, { action: 'hide', key: 'shared', occluded: true })
  expect(mocks.contents.send).toHaveBeenLastCalledWith('browser:visibility', true)
  expect(allowed(mainFrame)).toBe(false)
  mocks.contents.send.mockClear()
  // Navigating to another Studio section can leave the native view already hidden.
  await call(event, { action: 'hide', key: 'shared' })
  expect(mocks.contents.send).toHaveBeenLastCalledWith('browser:visibility', false)
  expect(allowed(mainFrame)).toBe(true)
  expect(allowed({ senderFrame: {} })).toBe(false)
  mocks.automaticPip = false
  expect(allowed(mainFrame)).toBe(false)
  await call(event, workspaceShow)
  expect(mocks.contents.send).toHaveBeenLastCalledWith('browser:visibility', true)
  expect(allowed(mainFrame)).toBe(false)
})

it('grants automatic native video PiP only to the approved hidden main frame', async () => {
  const call = handler()
  await call(event, workspaceShow)
  const enter = mocks.contents.ipc.handle.mock.calls.find(
    ([name]) => name === 'browser:video-pip-auto',
  )?.[1]
  if (typeof enter !== 'function') throw new Error('Missing automatic video PiP handler')
  const main = { senderFrame: mocks.contents.mainFrame }
  mocks.contents.mainFrame.executeJavaScript.mockClear()
  mocks.automaticPip = true
  expect(enter(main)).toBe(false)
  await call(event, { action: 'hide', key: 'shared' })
  mocks.automaticPip = false
  expect(enter(main)).toBe(false)
  mocks.automaticPip = true
  expect(enter({ senderFrame: {} })).toBe(false)
  expect(mocks.contents.mainFrame.executeJavaScript).not.toHaveBeenCalled()
  await enter(main)
  expect(mocks.contents.mainFrame.executeJavaScript).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining('requestPictureInPicture'),
    true,
  )
})

it('reports a background page on tab switching and after its document reloads', async () => {
  const call = handler()
  await call(event, workspaceShow)
  await call(event, { action: 'watch-frames', key: 'shared', enabled: true })
  mocks.contents.send.mockClear()
  await call(event, { ...workspaceShow, key: 'next' })
  expect(mocks.contents.send).toHaveBeenCalledWith('browser:visibility', false)
  await call(event, { action: 'hide', key: 'next' })
  mocks.contents.send.mockClear()
  listener('dom-ready')?.()
  expect(mocks.contents.send).toHaveBeenLastCalledWith('browser:visibility', false)
})

it('reports visibility for thread previews and gives untracked session popups a native fallback', async () => {
  const call = handler()
  await call(event, { ...workspaceShow, workspaceBrowser: false })
  expect(mocks.contents.session.registerPreloadScript).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'dovo-browser-visibility', type: 'frame' }),
  )
  const initial = mocks.on.mock.calls.find(([name]) => name === 'browser:visibility-state')?.[1]
  if (!initial) throw new Error('Missing initial visibility handler')
  const request = { sender: mocks.contents, returnValue: null as boolean | null }
  initial(request)
  expect(request.returnValue).toBe(true)
  await call(event, { action: 'hide', key: 'shared' })
  initial(request)
  expect(request.returnValue).toBe(false)
  const popup = { sender: {}, returnValue: undefined }
  initial(popup)
  expect(popup.returnValue).toBe(null)
})

it('updates child frames and reports window hide/minimize/restore without treating blur as hidden', async () => {
  const call = handler()
  await call(event, workspaceShow)
  const child = { detached: false, send: vi.fn<Electron.WebFrameMain['send']>() }
  mocks.contents.mainFrame.framesInSubtree.push(child)
  try {
    const hidden = vi.spyOn(mocks.window, 'isVisible').mockReturnValue(false)
    const emit = (name: string) => {
      const callback = mocks.window.on.mock.calls.find(([event]) => event === name)?.[1]
      if (typeof callback !== 'function') throw new Error(`Missing ${name} handler`)
      callback()
    }
    emit('hide')
    expect(child.send).toHaveBeenLastCalledWith('browser:visibility', false)
    hidden.mockReturnValue(true)
    emit('show')
    expect(child.send).toHaveBeenLastCalledWith('browser:visibility', true)
    const minimized = vi.spyOn(mocks.window, 'isMinimized').mockReturnValue(true)
    emit('minimize')
    expect(child.send).toHaveBeenLastCalledWith('browser:visibility', false)
    minimized.mockReturnValue(false)
    emit('restore')
    expect(child.send).toHaveBeenLastCalledWith('browser:visibility', true)
    expect(mocks.window.on.mock.calls.some(([event]) => event === 'blur')).toBe(false)
    child.detached = true
    child.send.mockClear()
    emit('hide')
    expect(child.send).not.toHaveBeenCalled()
  } finally {
    mocks.contents.mainFrame.framesInSubtree.length = 0
    vi.restoreAllMocks()
  }
})

it('detects native window visibility changes even when the platform emits no window event', async () => {
  vi.useFakeTimers()
  const call = handler()
  await call(event, workspaceShow)
  mocks.contents.send.mockClear()
  const hidden = vi.spyOn(mocks.window, 'isVisible').mockReturnValue(false)
  try {
    // A newly loading child frame must not consume a transition still owed to its parent.
    const initial = mocks.on.mock.calls.find(([name]) => name === 'browser:visibility-state')?.[1]
    if (!initial) throw new Error('Missing visibility handler')
    initial({ sender: mocks.contents })
    vi.advanceTimersByTime(250)
    expect(mocks.contents.send).toHaveBeenCalledExactlyOnceWith('browser:visibility', false)
    vi.advanceTimersByTime(500)
    expect(mocks.contents.send).toHaveBeenCalledOnce()
    hidden.mockReturnValue(true)
    vi.advanceTimersByTime(250)
    expect(mocks.contents.send).toHaveBeenLastCalledWith('browser:visibility', true)
  } finally {
    hidden.mockRestore()
  }
})

it('cleans up a failed frame subscription', async () => {
  const call = handler()
  await call(event, {
    action: 'show',
    key: 'failed',
    url: 'https://example.com/',
    bounds: { x: 0, y: 40, width: 400, height: 300 },
  })
  mocks.contents.beginFrameSubscription.mockImplementationOnce(() => {
    throw new Error('Renderer unavailable')
  })
  await expect(
    call(event, { action: 'watch-frames', key: 'failed', enabled: true }),
  ).rejects.toThrow('Renderer unavailable')
  expect(mocks.contents.setBackgroundThrottling).toHaveBeenLastCalledWith(true)
  await call(event, { action: 'watch-frames', key: 'failed', enabled: true })
  expect(mocks.contents.beginFrameSubscription).toHaveBeenCalledTimes(2)
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
  frameName?: string
  disposition: string
  features: string
  referrer?: { url: string; policy: string }
  postBody?: { contentType: string; boundary?: string; data: unknown[] }
}) => {
  action: string
  overrideBrowserWindowOptions?: { webPreferences?: object }
  createWindow?: (options: Electron.BrowserWindowConstructorOptions) => Electron.WebContents
}
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
it('fits an owned fullscreen view, restores its bounds and exits when hidden', async () => {
  const call = handler()
  await call(event, workspaceShow)
  listener('enter-html-full-screen')?.()
  expect(mocks.view.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 900, height: 700 })
  mocks.window.contentView.getBounds.mockReturnValue({ x: 0, y: 0, width: 1200, height: 800 })
  const resized = mocks.window.contentView.on.mock.calls.findLast(
    ([name]) => name === 'bounds-changed',
  )?.[1]
  if (typeof resized !== 'function') throw new Error('Missing fullscreen resize listener')
  resized()
  expect(mocks.view.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 1200, height: 800 })
  await call(event, { ...workspaceShow, bounds: { x: 20, y: 80, width: 600, height: 500 } })
  expect(mocks.view.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 1200, height: 800 })
  await call(event, { action: 'hide', key: 'shared' })
  expect(mocks.contents.executeJavaScript).toHaveBeenCalledWith(
    'document.fullscreenElement && document.exitFullscreen()',
  )
  listener('leave-html-full-screen')?.()
  expect(mocks.view.setBounds).toHaveBeenLastCalledWith({ x: 20, y: 80, width: 600, height: 500 })
})
it('does not move a tab until its fullscreen exit completes', async () => {
  const call = handler()
  await call(event, workspaceShow)
  listener('enter-html-full-screen')?.()
  const tab = {
    id: 'shared',
    title: 'Shared',
    url: 'https://example.com/',
    kind: 'web',
    profileId: 'default',
  }
  await expect(call(event, { action: 'move-tab', key: 'shared', tab })).rejects.toThrow(
    'Exit website fullscreen',
  )
  await call(event, { action: 'hide', key: 'shared' })
  await expect(call(event, { action: 'move-tab', key: 'shared', tab })).rejects.toThrow(
    'Exit website fullscreen',
  )
  listener('leave-html-full-screen')?.()
  await expect(call(event, { action: 'move-tab', key: 'shared', tab })).rejects.toThrow(
    'destination browser window is unavailable',
  )
})
it('keeps active calls unthrottled when hidden and when other keep-alive modes end', async () => {
  const call = handler()
  await call(event, workspaceShow)
  mocks.media.keepAlive.mockReturnValue(true)
  mocks.media.host?.activityChanged?.(mocks.contents as never)
  expect(mocks.contents.setBackgroundThrottling).toHaveBeenLastCalledWith(false)
  await call(event, { action: 'hide', key: 'shared' })
  expect(mocks.contents.setBackgroundThrottling).toHaveBeenLastCalledWith(false)
  await call(event, {
    action: 'keep-awake',
    key: 'shared',
    enabled: false,
    profileId: 'default',
    url: workspaceShow.url,
  })
  expect(mocks.contents.setBackgroundThrottling).toHaveBeenLastCalledWith(false)
  const videoPip = mocks.contents.ipc.on.mock.calls.find(
    ([name]) => name === 'browser:video-pip',
  )?.[1]
  if (typeof videoPip !== 'function') throw new Error('Missing video PiP listener')
  videoPip({ senderFrame: mocks.contents.mainFrame }, false)
  expect(mocks.contents.setBackgroundThrottling).toHaveBeenLastCalledWith(false)
  mocks.media.keepAlive.mockReturnValue(false)
  mocks.media.host?.activityChanged?.(mocks.contents as never)
  expect(mocks.contents.setBackgroundThrottling).toHaveBeenLastCalledWith(true)
})

it('allows fullscreen only for the active visible workspace page', async () => {
  const call = handler()
  await call(event, workspaceShow)
  expect(mocks.media.host?.canFullscreen(mocks.contents as never)).toBe(true)
  mocks.view.getVisible.mockReturnValueOnce(false)
  expect(mocks.media.host?.canFullscreen(mocks.contents as never)).toBe(false)
  await call(event, { action: 'hide', key: 'shared' })
  expect(mocks.media.host?.canFullscreen(mocks.contents as never)).toBe(false)
})
it.each([false, true])(
  'restores the owning window on fullscreen tab closure (previous fullscreen: %s)',
  async (alreadyFullscreen) => {
    const call = handler()
    await call(event, workspaceShow)
    mocks.window.isFullScreen.mockReturnValue(alreadyFullscreen)
    mocks.media.host?.prepareFullscreen(mocks.contents as never)
    listener('enter-html-full-screen')?.()
    mocks.window.setFullScreen.mockClear()
    await call(event, { action: 'close', key: 'shared' })
    expect(mocks.window.setFullScreen.mock.calls).toEqual(alreadyFullscreen ? [] : [[false]])
  },
)
it('focuses the exact existing tab without reloading it or letting thread previews consume the focus', async () => {
  const call = handler()
  await call(event, workspaceShow)
  mocks.contents.loadURL.mockClear()
  await call(event, { action: 'focus-tab', key: 'shared' })
  expect(mocks.window.webContents.send).toHaveBeenCalledWith('browser:focus-workspace')
  expect(mocks.window.focus).toHaveBeenCalled()
  expect(await call(event, { action: 'status', key: 'preview' })).toBeUndefined()
  expect(await call(event, { action: 'status', key: 'shared', tabCount: 1 })).toHaveProperty(
    'focusedTabKey',
    'shared',
  )
  expect(await call(event, { action: 'status', key: 'shared', tabCount: 1 })).not.toHaveProperty(
    'focusedTabKey',
  )
  expect(mocks.contents.loadURL).not.toHaveBeenCalled()
})
it('routes website notification clicks by the source tab and ignores foreign frames', async () => {
  const call = handler()
  await call(event, workspaceShow)
  const clicked = mocks.contents.ipc.on.mock.calls.find(
    ([name]) => name === 'browser:notification-click',
  )?.[1]
  if (typeof clicked !== 'function') throw new Error('Missing notification routing')
  clicked({ senderFrame: { url: 'https://other.example/' } })
  expect(mocks.window.webContents.send).not.toHaveBeenCalled()
  clicked({ senderFrame: mocks.contents.mainFrame })
  expect(await call(event, { action: 'status', key: 'shared', tabCount: 1 })).toHaveProperty(
    'focusedTabKey',
    'shared',
  )
})
it('keeps an explicitly awake page loaded and unthrottled until the setting is disabled', async () => {
  vi.useFakeTimers()
  const call = handler()
  const command = {
    action: 'keep-awake',
    key: 'shared',
    url: workspaceShow.url,
    profileId: 'default',
    enabled: true,
  }
  await call(event, command)
  expect(mocks.contents.setBackgroundThrottling).toHaveBeenLastCalledWith(false)
  await call(event, { action: 'hide', key: 'shared' })
  await vi.advanceTimersByTimeAsync(6 * 60_000)
  expect(mocks.contents.close).not.toHaveBeenCalled()
  expect(await call(event, { action: 'tab-activity', key: 'activity' })).toHaveProperty(
    'protectedKeys',
    ['shared'],
  )
  await call(event, { ...command, enabled: false })
  expect(mocks.contents.setBackgroundThrottling).toHaveBeenLastCalledWith(true)
  await vi.advanceTimersByTimeAsync(30_000)
  expect(mocks.contents.close).toHaveBeenCalledOnce()
})
it.each([
  'https://teams.microsoft.com/v2/',
  'https://outlook.office.com/mail/',
  'https://mail.google.com/mail/u/0/',
  'https://app.slack.com/client/T123/C123',
  'https://example-workspace.slack.com/',
  'https://discord.com/channels/@me',
  'https://canary.discord.com/channels/@me',
  'https://ptb.discord.com/channels/@me',
  'https://web.whatsapp.com/',
  'https://chat.google.com/',
])(
  'keeps %s unthrottled and retained by default, respecting an opt-out after reload',
  async (url) => {
    vi.useFakeTimers()
    vi.spyOn(mocks.contents, 'getURL').mockReturnValue(url)
    const call = handler()
    await call(event, { ...workspaceShow, url })
    await call(event, { action: 'hide', key: 'shared' })
    expect(mocks.contents.setBackgroundThrottling).toHaveBeenLastCalledWith(false)
    await vi.advanceTimersByTimeAsync(6 * 60_000)
    expect(mocks.contents.close).not.toHaveBeenCalled()
    await call(event, {
      action: 'keep-awake',
      key: 'shared',
      url,
      profileId: 'default',
      enabled: false,
    })
    expect(mocks.contents.setBackgroundThrottling).toHaveBeenLastCalledWith(true)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(mocks.contents.close).toHaveBeenCalledOnce()
    await call(event, { ...workspaceShow, url, keepAwake: false })
    expect(mocks.contents.setBackgroundThrottling).toHaveBeenLastCalledWith(true)
  },
)

it('follows communication-app defaults across navigation without applying them to thread previews', async () => {
  const url = vi.spyOn(mocks.contents, 'getURL').mockReturnValue('https://example.com/')
  const call = handler()
  await call(event, workspaceShow)
  url.mockReturnValue('https://mail.google.com/')
  listener('did-navigate')?.()
  expect(mocks.contents.setBackgroundThrottling).toHaveBeenLastCalledWith(false)
  url.mockReturnValue('https://example.com/')
  listener('did-navigate')?.()
  expect(mocks.contents.setBackgroundThrottling).toHaveBeenLastCalledWith(true)
  await call(event, { action: 'close', key: 'shared' })
  url.mockReturnValue('https://mail.google.com/')
  await call(event, { ...workspaceShow, workspaceBrowser: false, url: 'https://mail.google.com/' })
  expect(mocks.contents.setBackgroundThrottling).toHaveBeenLastCalledWith(true)
})

it('releases a sleeping background page immediately, even when Keep awake was enabled', async () => {
  const call = handler()
  await call(event, { ...workspaceShow, keepAwake: true })
  await call(event, { action: 'sleep', key: 'shared' })
  expect(mocks.contents.close).not.toHaveBeenCalled()
  await call(event, { action: 'hide', key: 'shared' })
  expect(mocks.contents.close).toHaveBeenCalledOnce()
  expect(mocks.contents.setBackgroundThrottling).toHaveBeenLastCalledWith(true)
})

it('defers sleeping during live media and releases the page after activity ends', async () => {
  vi.useFakeTimers()
  const call = handler()
  await call(event, workspaceShow)
  mocks.media.keepAlive.mockReturnValue(true)
  await call(event, { action: 'hide', key: 'shared' })
  await call(event, { action: 'sleep', key: 'shared' })
  await vi.advanceTimersByTimeAsync(6 * 60_000)
  expect(mocks.contents.close).not.toHaveBeenCalled()
  mocks.media.keepAlive.mockReturnValue(false)
  await vi.advanceTimersByTimeAsync(30_000)
  expect(mocks.contents.close).toHaveBeenCalledOnce()
})

it('throttles sleeping private tabs without deleting their in-memory sign-in data', async () => {
  vi.useFakeTimers()
  const call = handler()
  await call(event, { ...workspaceShow, profileId: 'private-12345678-1234-4234-8234-123456789abc' })
  await call(event, { action: 'hide', key: 'shared' })
  await call(event, { action: 'sleep', key: 'shared' })
  await vi.advanceTimersByTimeAsync(6 * 60_000)
  expect(mocks.contents.setBackgroundThrottling).toHaveBeenLastCalledWith(true)
  expect(mocks.contents.close).not.toHaveBeenCalled()
  expect(mocks.contents.session.clearStorageData).not.toHaveBeenCalled()
})
it.each(['close', 'reload', 'sleep'] as const)(
  'cancels background restoration after tab %s',
  async (reason) => {
    const call = handler()
    let ready = () => {}
    mocks.extensions.prepare.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          ready = resolve
        }),
    )
    const restoring = call(event, {
      action: 'keep-awake',
      key: 'shared',
      url: workspaceShow.url,
      profileId: 'default',
      enabled: true,
    })
    if (reason !== 'reload') await call(event, { action: reason, key: 'shared' })
    else
      mocks.window.webContents.on.mock.calls.find(([name]) => name === 'did-start-navigation')?.[1](
        { isMainFrame: true, isSameDocument: false },
      )
    ready()
    await restoring
    expect(mocks.create).not.toHaveBeenCalled()
  },
)
it('does not navigate a concurrently restored tab in another profile', async () => {
  const call = handler()
  let ready = () => {}
  mocks.extensions.prepare.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        ready = resolve
      }),
  )
  const restoring = call(event, {
    action: 'keep-awake',
    key: 'shared',
    url: 'https://old.example/',
    profileId: 'default',
    enabled: true,
  })
  await call(event, { ...workspaceShow, profileId: 'other' })
  mocks.contents.loadURL.mockClear()
  ready()
  await expect(restoring).rejects.toThrow('tab changed')
  expect(mocks.contents.loadURL).not.toHaveBeenCalled()
})
it('routes links and new-window popups into their linked profile', async () => {
  const call = handler()
  await call(event, workspaceShow)
  mocks.linkProfile.mockReturnValue('work')
  const open = openHandler()
  const target = 'https://routed.example/'
  expect(open({ url: target, disposition: 'foreground-tab', features: '' })).toEqual({
    action: 'deny',
  })
  await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2))
  const status = await call(event, { action: 'status', key: 'shared', tabCount: 1 })
  expect(status).toHaveProperty('createdTabs', [
    expect.objectContaining({ url: target, profileId: 'work', openerKey: 'shared' }),
  ])
  expect(
    open({ url: target, disposition: 'new-window', features: 'width=500,height=400' }),
  ).toMatchObject({ action: 'deny' })
  await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(3))
  await expect(
    call(event, { action: 'status', key: 'shared', tabCount: 1 }),
  ).resolves.toMatchObject({
    createdTabs: [expect.objectContaining({ url: target, profileId: 'work', openerKey: 'shared' })],
  })
})
it('keeps the target URL available while a replacement profile has not committed a page', async () => {
  const call = handler()
  await call(event, workspaceShow)
  const target = 'https://example.com/current?query=kept#section'
  await call(event, { ...workspaceShow, profileId: 'work', url: target })
  expect(mocks.contents.loadURL).toHaveBeenLastCalledWith(target)
  vi.spyOn(mocks.contents, 'getURL').mockReturnValueOnce('')
  await expect(call(event, { action: 'status', key: 'shared' })).resolves.toMatchObject({
    url: target,
  })
})
it('routes only page-initiated main-frame GET requests and leaves form bodies and browser loads intact', async () => {
  const call = handler()
  await call(event, workspaceShow)
  mocks.linkProfile.mockReturnValue('work')
  const request = mocks.contents.session.webRequest.onBeforeRequest.mock.calls[0]?.[0]
  if (typeof request !== 'function') throw new Error('Missing navigation routing')
  const navigate = mocks.contents.on.mock.calls
    .filter(([name]) => name === 'will-navigate')
    .at(0)?.[1]
  if (typeof navigate !== 'function') throw new Error('Missing page navigation handler')
  const respond = vi.fn<(value: { cancel?: boolean }) => void>()
  const target = 'https://routed.example/'
  const details = {
    url: target,
    resourceType: 'mainFrame',
    webContentsId: mocks.contents.id,
    method: 'GET',
  }
  // Programmatic loads do not emit will-navigate and must preserve their explicit profile.
  request(details, respond)
  expect(respond).toHaveBeenLastCalledWith({ cancel: false })
  navigate({}, target)
  request({ ...details, method: 'POST' }, respond)
  expect(respond).toHaveBeenLastCalledWith({ cancel: false })
  expect(mocks.create).toHaveBeenCalledOnce()
  navigate({}, target + '#call')
  request({ ...details, resourceType: 'subFrame' }, respond)
  expect(respond).toHaveBeenLastCalledWith({})
  request(details, respond)
  expect(respond).toHaveBeenLastCalledWith({ cancel: true })
  expect(mocks.contents.stop).toHaveBeenCalledOnce()
  await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2))
  expect(mocks.contents.loadURL).toHaveBeenLastCalledWith(target + '#call')
})
it('protects website-native video PiP and leaves it open when focusing the original tab', async () => {
  const call = handler()
  await call(event, workspaceShow)
  const changed = mocks.contents.ipc.on.mock.calls.find(
    ([name]) => name === 'browser:video-pip',
  )?.[1]
  if (typeof changed !== 'function') throw new Error('Missing native video PiP tracking')
  changed({ senderFrame: mocks.contents.mainFrame }, true)
  expect(mocks.contents.setBackgroundThrottling).toHaveBeenLastCalledWith(false)
  expect(await call(event, { action: 'tab-activity', key: 'activity' })).toHaveProperty(
    'protectedKeys',
    ['shared'],
  )
  mocks.contents.mainFrame.executeJavaScript.mockClear()
  await call(event, { action: 'focus-tab', key: 'shared' })
  expect(mocks.contents.mainFrame.executeJavaScript).not.toHaveBeenCalled()
  expect(mocks.contents.setBackgroundThrottling).toHaveBeenLastCalledWith(false)
  changed({ senderFrame: mocks.contents.mainFrame }, false)
  expect(mocks.contents.setBackgroundThrottling).toHaveBeenLastCalledWith(true)
  expect(await call(event, { action: 'tab-activity', key: 'activity' })).toHaveProperty(
    'protectedKeys',
    [],
  )
})
it('keeps native Document PiP disabled and denies unticketed blank popups', async () => {
  const call = handler()
  await call(event, workspaceShow)
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({
      webPreferences: expect.objectContaining({
        disableBlinkFeatures: 'DocumentPictureInPictureAPI',
      }),
    }),
  )
  expect(openHandler()({ url: 'about:blank', disposition: 'other', features: '' })).toEqual({
    action: 'deny',
  })
})

function popupWindow() {
  const popup = {
    close: vi.fn<() => void>(),
    getParentWindow: () => mocks.window,
    setParentWindow: vi.fn<(window: unknown) => void>(),
    setAlwaysOnTop: vi.fn<(flag: boolean, level: string) => void>(),
    setVisibleOnAllWorkspaces: vi.fn<(flag: boolean) => void>(),
    on: vi.fn<(event: string, callback: () => void) => void>(),
    isDestroyed: () => false,
    once: vi.fn<(event: string, callback: () => void) => void>(),
    webContents: {
      mainFrame: {},
      isDestroyed: () => false,
      isCurrentlyAudible: () => false,
      isAudioMuted: () => false,
      setAudioMuted: vi.fn<(muted: boolean) => void>(),
      getTitle: () => 'Floating call',
      ipc: {
        handle: vi.fn<(name: string, handler: (...args: unknown[]) => unknown) => void>(),
        on: vi.fn<(name: string, handler: (...args: unknown[]) => unknown) => void>(),
      },
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

it('reports media and capture sources without consuming queued tab events', async () => {
  const call = handler()
  await call(event, workspaceShow)
  mocks.media.keepAlive.mockReturnValue(true)
  mocks.media.snapshot.mockReturnValue({
    captures: [{ key: 'requester', sourceKey: 'remote-source' }],
  })
  openHandler()({
    url: 'https://example.com/child',
    disposition: 'foreground-tab',
    features: '',
  }).createWindow?.({})
  await expect(call(event, { action: 'tab-activity', key: 'cleanup' })).resolves.toMatchObject({
    protectedKeys: expect.arrayContaining(['shared', 'requester', 'remote-source']),
  })
  await expect(call(event, { action: 'status', key: 'shared' })).resolves.toMatchObject({
    createdTabs: [{ url: 'https://example.com/child' }],
  })
})

it('adopts bounded native new tabs with their profile, background disposition and opener preferences', async () => {
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
  ]) {
    const result = open({ url, disposition, features: '' })
    const allowed = [
      'https://example.com/tab',
      'http://192.168.1.20:3000/',
      'https://example.com/shift',
    ].includes(url)
    expect(result.action).toBe(allowed ? 'allow' : 'deny')
    expect(allowed || Object.keys(result).length === 1).toBe(true)
    if (allowed) result.createWindow?.({ webPreferences: { javascript: true } })
  }
  await expect(call(event, { action: 'status', key: 'shared' })).resolves.toMatchObject({
    createdTabs: [
      { url: 'https://example.com/tab', active: true },
      { url: 'http://192.168.1.20:3000/', active: false },
      { url: 'https://example.com/shift', active: true },
    ],
  })
  expect(await call(event, { action: 'status', key: 'shared' })).not.toHaveProperty('createdTabs')
  for (let i = 0; i < 30; i++)
    open({
      url: `https://example.com/${i}`,
      disposition: 'foreground-tab',
      features: '',
    }).createWindow?.({})
  const status = (await call(event, { action: 'status', key: 'shared' })) as {
    createdTabs: { url: string }[]
  }
  expect(status.createdTabs).toHaveLength(20)
  expect(status.createdTabs[0]!.url).toBe('https://example.com/0')
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
  const noOpener = open({ ...request, features: 'noopener,width=500' })
  expect(noOpener.action).toBe('allow')
  const created = listener('did-create-window')
  const first = popupWindow()
  const second = popupWindow()
  created?.(first)
  created?.(second)
  expect(open(request)).toEqual({ action: 'deny' })
  noOpener.createWindow?.({})
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
    openedLinks: ['https://example.com/help'],
    createdTabs: [{ url: 'https://accounts.example.com/authorize' }],
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

it.each([true, false])(
  'keeps private tab storage in memory (workspace: %s)',
  async (workspaceBrowser) => {
    const call = handler()
    const profileId = 'private-00000000-0000-4000-8000-000000000001'
    await call(event, { ...workspaceShow, profileId, workspaceBrowser })
    expect(mocks.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        webPreferences: expect.objectContaining({
          partition: `${workspaceBrowser ? 'dovo-browser-workspace' : 'dovo-preview'}:${profileId}`,
        }),
      }),
    )
    await call(event, { action: 'close', key: workspaceShow.key })
    expect(mocks.contents.session.clearStorageData).toHaveBeenCalledOnce()
    expect(mocks.contents.session.clearCache).toHaveBeenCalledOnce()
    expect(mocks.contents.session.closeAllConnections).toHaveBeenCalledOnce()
  },
)

it('releases a self-closed tab once and can recreate its native view', async () => {
  const call = handler()
  await call(event, workspaceShow)
  const listeners = mocks.contents.once.mock.calls
    .filter(([name]) => name === 'destroyed')
    .map(([, listener]) => listener)
  const destroyed = () => {
    for (const listener of listeners) if (typeof listener === 'function') listener()
  }
  mocks.contents.isDestroyed.mockReturnValue(true)
  Object.defineProperty(mocks.view, 'webContents', { value: undefined, configurable: true })
  try {
    destroyed()
    destroyed()
    expect(mocks.media.releaseTab).toHaveBeenCalledOnce()
    expect(mocks.extensions.removeTab).toHaveBeenCalledOnce()
    expect(mocks.window.webContents.focus).toHaveBeenCalledOnce()
    expect(mocks.contents.close).not.toHaveBeenCalled()
    expect(await call(event, { action: 'status', key: workspaceShow.key })).toMatchObject({
      closedTabs: [workspaceShow.key],
    })
    expect(await call(event, { action: 'status', key: workspaceShow.key })).toBeUndefined()
    await call(event, { action: 'close', key: workspaceShow.key })
  } finally {
    Object.defineProperty(mocks.view, 'webContents', { value: mocks.contents, configurable: true })
    mocks.contents.isDestroyed.mockReturnValue(false)
  }
  await call(event, workspaceShow)
  expect(mocks.create).toHaveBeenCalledTimes(2)
})

it('reports a crashed website once and leaves reload available', async () => {
  const call = handler()
  await call(event, workspaceShow)
  listener('render-process-gone')?.({}, { reason: 'crashed' })
  await expect(call(event, { action: 'status', key: workspaceShow.key })).rejects.toThrow(
    'This page stopped unexpectedly',
  )
  await expect(call(event, { action: 'status', key: workspaceShow.key })).resolves.toMatchObject({
    url: 'https://example.com/',
  })
  await call(event, { action: 'reload', key: workspaceShow.key })
  expect(mocks.contents.reload).toHaveBeenCalledOnce()
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
  expect(host.tabs().map((tab) => tab.key)).toEqual(['shared'])
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
    callTabs: [],
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
    callTabs: [],
  })
  mocks.media.snapshot.mockReturnValue({})
  await expect(call(event, { action: 'media-status', key: 'studio-media' })).resolves.toEqual({
    url: '',
    back: false,
    forward: false,
    callTabs: [],
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

it('routes workspace context menus to the selected page and keeps password text private', async () => {
  const call = handler()
  await call(event, workspaceShow)
  const show = (password = false) =>
    listener('context-menu')?.(
      {},
      {
        linkURL: 'https://example.com/link',
        selectionText: 'Exact selected text',
        formControlType: password ? 'input-password' : 'textarea',
        isEditable: true,
      },
    )
  show()
  const items = mocks.menu.mock.calls.at(-1)?.[0] ?? []
  const click = (label: string) => {
    const item = items.find((item) => item.label === label)
    if (!item?.click) throw new Error(`Missing ${label}`)
    item.click(
      {} as import('electron').MenuItem,
      mocks.window as unknown as import('electron').BrowserWindow,
      {} as import('electron').KeyboardEvent,
    )
  }
  click('Copy')
  expect(mocks.clipboard).toHaveBeenLastCalledWith('Exact selected text')
  click('Reload')
  expect(mocks.contents.reload).toHaveBeenCalledOnce()
  click('Add selection to thread…')
  expect(mocks.window.webContents.send).toHaveBeenLastCalledWith('browser:context-action', {
    key: 'shared',
    action: 'selection',
    text: 'Exact selected text',
    url: 'https://example.com/',
    title: 'Example',
  })
  click('Open link in new tab')
  await expect(call(event, { action: 'status', key: 'shared' })).resolves.toMatchObject({
    openedLinks: ['https://example.com/link'],
  })
  show(true)
  const passwordItems = mocks.menu.mock.calls.at(-1)?.[0] ?? []
  expect(
    passwordItems.some(
      (item) => item.label === 'Copy' || item.label === 'Add selection to thread…',
    ),
  ).toBe(false)
  expect(passwordItems.find((item) => item.role === 'cut')?.enabled).toBe(false)
  await call(event, { action: 'close', key: 'shared' })
  mocks.menu.mockClear()
  show()
  expect(mocks.menu).not.toHaveBeenCalled()
})

it('offers native image actions for the clicked image, including linked and generated images', async () => {
  const call = handler()
  await call(event, workspaceShow)
  const params = {
    mediaType: 'image',
    hasImageContents: true,
    srcURL: 'http://images.lan/photo.png',
    linkURL: 'https://example.com/link',
    x: 41,
    y: 72,
    selectionText: '',
    formControlType: 'none',
    isEditable: false,
  }
  const menu = (changes: Partial<typeof params> = {}) => {
    listener('context-menu')?.({}, { ...params, ...changes })
    return mocks.menu.mock.calls.at(-1)?.[0] ?? []
  }
  const click = (items: Electron.MenuItemConstructorOptions[], label: string) => {
    const item = items.find((item) => item.label === label)
    if (!item?.click) throw new Error(`Missing ${label}`)
    item.click(
      {} as Electron.MenuItem,
      mocks.window as unknown as Electron.BrowserWindow,
      {} as Electron.KeyboardEvent,
    )
  }
  const items = menu()
  click(items, 'Copy image')
  expect(mocks.contents.copyImageAt).toHaveBeenLastCalledWith(41, 72)
  click(items, 'Download image')
  expect(mocks.contents.downloadURL).toHaveBeenLastCalledWith(params.srcURL)
  click(items, 'Copy image address')
  expect(mocks.clipboard).toHaveBeenLastCalledWith(params.srcURL)
  click(items, 'Open image in new tab')
  await expect(call(event, { action: 'status', key: 'shared' })).resolves.toMatchObject({
    openedLinks: [params.srcURL],
  })
  expect(
    menu({ hasImageContents: false }).find((item) => item.label === 'Copy image')?.enabled,
  ).toBe(false)
  for (const srcURL of ['data:image/png;base64,cGl4ZWw=', 'blob:https://example.com/image']) {
    const generated = menu({ srcURL })
    expect(generated.some((item) => item.label === 'Open image in new tab')).toBe(false)
    click(generated, 'Download image')
    expect(mocks.contents.downloadURL).toHaveBeenLastCalledWith(srcURL)
  }
  const canvas = menu({ mediaType: 'canvas', srcURL: '' })
  click(canvas, 'Copy image')
  expect(
    canvas.some((item) => item.label === 'Copy image address' || item.label === 'Download image'),
  ).toBe(false)
  for (const srcURL of ['file:///private/image.png', 'javascript:alert(1)'])
    expect(
      menu({ srcURL }).some(
        (item) => item.label === 'Download image' || item.label === 'Open image in new tab',
      ),
    ).toBe(false)
  expect(menu({ mediaType: 'none' }).some((item) => item.label === 'Copy image')).toBe(false)
  const stale = menu()
  mocks.contents.copyImageAt.mockClear()
  mocks.contents.downloadURL.mockClear()
  listener('did-start-navigation')?.({}, 'https://example.com/next', false, true)
  click(stale, 'Copy image')
  click(stale, 'Download image')
  expect(mocks.contents.copyImageAt).not.toHaveBeenCalled()
  expect(mocks.contents.downloadURL).not.toHaveBeenCalled()
  const closed = menu()
  await call(event, { action: 'close', key: 'shared' })
  click(closed, 'Copy image')
  click(closed, 'Download image')
  expect(mocks.contents.copyImageAt).not.toHaveBeenCalled()
  expect(mocks.contents.downloadURL).not.toHaveBeenCalled()
})

it('offers picture-in-picture only for the selected supported video and its frame', async () => {
  const call = handler()
  await call(event, workspaceShow)
  const executeJavaScript = mocks.contents.mainFrame.executeJavaScript
  const params = {
    frame: mocks.contents.mainFrame,
    x: 100,
    y: 200,
    mediaType: 'video',
    srcURL: '',
    hasImageContents: false,
    mediaFlags: { canShowPictureInPicture: true, isShowingPictureInPicture: false },
    linkURL: '',
    selectionText: '',
    formControlType: 'none',
    isEditable: false,
  }
  listener('context-menu')?.({}, params)
  const item = mocks.menu.mock.calls
    .at(-1)?.[0]
    .find((entry) => entry.label === 'Picture-in-Picture')
  expect(item?.click).toBeDefined()
  item?.click?.(
    {} as import('electron').MenuItem,
    mocks.window as unknown as import('electron').BrowserWindow,
    {} as import('electron').KeyboardEvent,
  )
  expect(executeJavaScript).toHaveBeenCalledWith(
    expect.stringContaining('requestPictureInPicture'),
    true,
  )
  executeJavaScript.mockClear()
  listener('did-start-navigation')?.({}, 'https://example.com/', false, true)
  item?.click?.(
    {} as import('electron').MenuItem,
    mocks.window as unknown as import('electron').BrowserWindow,
    {} as import('electron').KeyboardEvent,
  )
  expect(executeJavaScript).not.toHaveBeenCalled()
  listener('context-menu')?.({}, { ...params, mediaType: 'image' })
  expect(
    mocks.menu.mock.calls.at(-1)?.[0].some((entry) => entry.label === 'Picture-in-Picture'),
  ).toBe(false)
  listener('context-menu')?.(
    {},
    {
      ...params,
      mediaFlags: { canShowPictureInPicture: false, isShowingPictureInPicture: false },
    },
  )
  expect(
    mocks.menu.mock.calls.at(-1)?.[0].some((entry) => entry.label === 'Picture-in-Picture'),
  ).toBe(false)
  listener('context-menu')?.(
    {},
    {
      ...params,
      mediaFlags: { canShowPictureInPicture: false, isShowingPictureInPicture: true },
    },
  )
  expect(
    mocks.menu.mock.calls.at(-1)?.[0].some((entry) => entry.label === 'Exit Picture-in-Picture'),
  ).toBe(true)
  listener('context-menu')?.(
    {},
    { ...params, frame: { ...mocks.contents.mainFrame, routingId: 2 } },
  )
  expect(
    mocks.menu.mock.calls.at(-1)?.[0].some((entry) => entry.label === 'Picture-in-Picture'),
  ).toBe(false)
  listener('context-menu')?.({}, { ...params, frame: null })
  expect(
    mocks.menu.mock.calls.at(-1)?.[0].some((entry) => entry.label === 'Picture-in-Picture'),
  ).toBe(false)
})

it('captures a bounded website favicon and exposes it in native status', async () => {
  const call = handler()
  await call(event, workspaceShow)
  mocks.contents.session.fetch.mockResolvedValueOnce(
    new Response(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
        'base64',
      ),
      { headers: { 'content-type': 'image/png' } },
    ),
  )
  listener('page-favicon-updated')?.({}, ['https://example.com/favicon.png'])
  await vi.waitFor(async () =>
    expect(await call(event, { action: 'status', key: 'shared' })).toMatchObject({
      favicon: expect.stringMatching(/^data:image\/png;base64,/),
    }),
  )
  listener('did-start-navigation')?.({}, 'https://example.com/next', false, true)
  expect(await call(event, { action: 'status', key: 'shared' })).not.toHaveProperty(
    'favicon',
    expect.any(String),
  )
  mocks.contents.session.fetch.mockResolvedValueOnce(
    new Response('not an image', { headers: { 'content-type': 'text/html' } }),
  )
  listener('page-favicon-updated')?.({}, ['https://example.com/not-icon'])
  await vi.waitFor(() => expect(mocks.contents.session.fetch).toHaveBeenCalledTimes(3))
  expect(await call(event, { action: 'status', key: 'shared' })).not.toHaveProperty(
    'favicon',
    expect.any(String),
  )
})

it('raises the selected native view and returns input focus on a deliberate page click', async () => {
  const call = handler()
  await call(event, { ...workspaceShow, key: 'login' })
  expect(mocks.window.contentView.addChildView).toHaveBeenLastCalledWith(mocks.view)
  const click = mocks.contents.on.mock.calls.find(
    ([name]) => name === 'before-mouse-event',
  )?.[1] as (event: unknown, input: { type: string }) => void
  expect(click).toBeDefined()
  mocks.contents.focus.mockClear()
  click({}, { type: 'mouseMove' })
  expect(mocks.contents.focus).not.toHaveBeenCalled()
  click({}, { type: 'mouseDown' })
  expect(mocks.contents.focus).toHaveBeenCalledOnce()
  await call(event, { action: 'hide', key: 'login' })
  click({}, { type: 'mouseDown' })
  expect(mocks.contents.focus).toHaveBeenCalledOnce()
})

it('prevents embedded sites from retaining window drag regions across navigation', async () => {
  await handler()(event, workspaceShow)
  const ready = mocks.contents.on.mock.calls.find(([name]) => name === 'dom-ready')?.[1]
  if (typeof ready !== 'function') throw new Error('Missing page readiness listener')
  ready()
  ready()
  expect(mocks.contents.insertCSS.mock.calls).toEqual([
    ['* { -webkit-app-region: no-drag !important; }', { cssOrigin: 'user' }],
    ['* { -webkit-app-region: no-drag !important; }', { cssOrigin: 'user' }],
  ])
})

it('resizes the selected page without reattaching it or resetting its input viewport', async () => {
  const call = handler()
  await call(event, workspaceShow)
  mocks.window.contentView.addChildView.mockClear()
  mocks.view.setVisible.mockClear()
  mocks.contents.disableDeviceEmulation.mockClear()
  const bounds = { x: 20, y: 100, width: 600, height: 400 }
  await call(event, { ...workspaceShow, bounds })
  expect(mocks.view.setBounds).toHaveBeenLastCalledWith(bounds)
  mocks.view.getBounds.mockReturnValueOnce(bounds)
  mocks.view.setBounds.mockClear()
  await call(event, { ...workspaceShow, bounds })
  expect(mocks.view.setBounds).not.toHaveBeenCalled()
  expect(mocks.window.contentView.addChildView).not.toHaveBeenCalled()
  expect(mocks.view.setVisible).not.toHaveBeenCalled()
  expect(mocks.contents.disableDeviceEmulation).not.toHaveBeenCalled()
})

it('updates device emulation only when metrics change and clears it when returning to fill', async () => {
  const call = handler()
  const viewport = { width: 390, height: 844 }
  await call(event, { ...workspaceShow, viewport })
  await call(event, { ...workspaceShow, viewport })
  expect(mocks.contents.enableDeviceEmulation).toHaveBeenCalledOnce()
  await call(event, { ...workspaceShow, viewport: { width: 800, height: 600 } })
  expect(mocks.contents.enableDeviceEmulation).toHaveBeenCalledTimes(2)
  await call(event, workspaceShow)
  await call(event, workspaceShow)
  expect(mocks.contents.disableDeviceEmulation).toHaveBeenCalledOnce()
})

it.each(['window', 'page'] as const)(
  'moves an active call with shortcuts and cleanup in its new window (%s close)',
  async (close) => {
    const target = {
      ...mocks.window,
      id: 2,
      once: vi.fn<typeof mocks.window.once>(),
      contentView: {
        children: [] as unknown[],
        on: vi.fn<typeof mocks.window.contentView.on>(),
        getBounds: mocks.window.contentView.getBounds,
        addChildView: vi.fn<typeof mocks.window.contentView.addChildView>(),
        removeChildView: vi.fn<typeof mocks.window.contentView.removeChildView>(),
      },
      webContents: {
        ...mocks.window.webContents,
        focus: vi.fn<typeof mocks.window.webContents.focus>(),
        sendInputEvent: vi.fn<typeof mocks.window.webContents.sendInputEvent>(),
        send: vi.fn<typeof mocks.window.webContents.send>(),
      },
    }
    registrations.push(
      registerBrowser('/app/index.html', undefined, undefined, {
        create: async () => target as never,
        list: () => [target as never],
      }),
    )
    const call = mocks.handle.mock.calls.at(-1)![1]
    const tab = {
      id: 'moving',
      title: 'Keep this page',
      url: 'https://example.com/',
      kind: 'web',
      profileId: 'work',
      pinned: true,
    } as const
    await call(event, {
      action: 'show',
      key: 'moving-key',
      workspaceBrowser: true,
      profileId: 'work',
      url: tab.url,
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    })
    const popup = popupWindow()
    listener('did-create-window')?.(popup)
    const pip = popupWindow()
    const authorize = mocks.contents.ipc.handle.mock.calls.find(
      ([name]) => name === 'browser:document-pip-authorize',
    )?.[1]
    if (typeof authorize !== 'function') throw new Error('Missing PiP authorization')
    const name = authorize({ senderFrame: mocks.contents.mainFrame }, true, false)
    mocks.pipWindow.mockReturnValue({ window: pip as never, contents: pip.webContents as never })
    openHandler()({
      url: 'about:blank',
      frameName: name,
      disposition: 'new-window',
      features: 'popup,width=420,height=280',
    }).createWindow?.({})
    const videoPip = mocks.contents.ipc.on.mock.calls.find(
      ([name]) => name === 'browser:video-pip',
    )?.[1]
    if (typeof videoPip !== 'function') throw new Error('Missing video PiP listener')
    videoPip({ senderFrame: mocks.contents.mainFrame }, true)
    mocks.media.keepAlive.mockReturnValue(true)
    await call(event, { action: 'move-tab', key: 'moving-key', tab, targetWindowId: 2 })
    expect(mocks.media.moveTab).toHaveBeenCalledWith(mocks.contents, target.id)
    expect(popup.close).not.toHaveBeenCalled()
    expect(pip.close).not.toHaveBeenCalled()
    expect(popup.setParentWindow).toHaveBeenCalledWith(target)
    expect(mocks.media.releaseTab).not.toHaveBeenCalled()
    expect(mocks.create).toHaveBeenCalledOnce()
    expect(mocks.contents.close).not.toHaveBeenCalled()
    expect(target.contentView.addChildView).toHaveBeenCalledWith(mocks.view)
    expect(target.webContents.send).toHaveBeenCalledWith('browser:focus-workspace')
    const shortcut = mocks.contents.on.mock.calls.find(
      ([name]) => name === 'before-input-event',
    )?.[1] as (event: unknown, input: unknown) => void
    shortcut(
      { preventDefault() {} },
      {
        type: 'keyDown',
        key: 't',
        control: process.platform !== 'darwin',
        meta: process.platform === 'darwin',
      },
    )
    expect(target.webContents.sendInputEvent).toHaveBeenCalledTimes(2)
    mocks.windowFor = target
    await expect(call(event, { action: 'status', key: 'thread-preview' })).resolves.toBeUndefined()
    await expect(
      call(event, { action: 'status', key: 'blank', tabCount: 0 }),
    ).resolves.toMatchObject({
      movedTabs: [{ key: 'moving-key', tab: { ...tab, title: 'Example' } }],
    })
    await call(event, {
      action: 'show',
      key: 'moving-key',
      workspaceBrowser: true,
      profileId: 'work',
      url: tab.url,
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    })
    expect(mocks.create).toHaveBeenCalledOnce()
    const sourceClosed = mocks.window.once.mock.calls.find(([name]) => name === 'closed')![1]
    sourceClosed()
    expect(mocks.contents.close).not.toHaveBeenCalled()
    target.webContents.focus.mockClear()
    mocks.window.webContents.focus.mockClear()
    if (close === 'page') {
      const listeners = mocks.contents.once.mock.calls
        .filter(([name]) => name === 'destroyed')
        .map(([, listener]) => listener)
      const destroyed = () => {
        for (const listener of listeners) if (typeof listener === 'function') listener()
      }
      mocks.contents.isDestroyed.mockReturnValue(true)
      destroyed()
    } else {
      const targetClosed = target.once.mock.calls.find(([name]) => name === 'closed')![1]
      targetClosed()
    }
    expect(target.webContents.focus).toHaveBeenCalledTimes(close === 'page' ? 1 : 0)
    expect(mocks.window.webContents.focus).not.toHaveBeenCalled()
    const closedTabEvent = expect.objectContaining({ closedTabs: ['moving-key'] })
    await expect(call(event, { action: 'status', key: 'moving-key' })).resolves.toEqual(
      close === 'page' ? closedTabEvent : undefined,
    )
    expect(mocks.contents.close).toHaveBeenCalledTimes(close === 'page' ? 0 : 1)
    mocks.contents.isDestroyed.mockReturnValue(false)
  },
)

it('refuses unavailable destinations without releasing an active call', async () => {
  const target = { ...mocks.window, id: 2 }
  const createWindow = vi.fn<() => Promise<import('electron').BrowserWindow>>(
    async () => target as never,
  )
  registrations.push(
    registerBrowser('/app/index.html', undefined, undefined, {
      create: createWindow,
      list: () => [target as never],
    }),
  )
  const call = mocks.handle.mock.calls.at(-1)![1]
  const tab = {
    id: 'moving',
    title: 'Page',
    url: 'https://example.com/',
    kind: 'web',
    profileId: 'work',
  }
  await call(event, {
    action: 'show',
    key: 'moving',
    workspaceBrowser: true,
    profileId: 'work',
    url: tab.url,
    bounds: { x: 0, y: 0, width: 800, height: 600 },
  })
  mocks.media.keepAlive.mockReturnValue(true)
  await expect(
    call(event, { action: 'move-tab', key: 'moving', tab, targetWindowId: 999 }),
  ).rejects.toThrow('unavailable')
  expect(mocks.contents.close).not.toHaveBeenCalled()
})

it('rejects stale website origins and thread-preview permission controls', async () => {
  const call = handler()
  await call(event, workspaceShow)
  await expect(
    call(event, {
      action: 'set-site-permission',
      key: workspaceShow.key,
      origin: 'https://old.example',
      permission: 'camera',
      setting: 'allow',
    }),
  ).rejects.toThrow('website changed')
  await expect(
    call(event, {
      action: 'request-site-permission',
      key: workspaceShow.key,
      origin: 'https://old.example',
      permission: 'notifications',
    }),
  ).rejects.toThrow('website changed')
  await expect(
    call(event, {
      action: 'clear-site-data',
      key: workspaceShow.key,
      origin: 'https://old.example',
    }),
  ).rejects.toThrow('website changed')
  const thread = { ...workspaceShow, key: 'thread-permissions', workspaceBrowser: false }
  await call(event, thread)
  await expect(call(event, { action: 'site-permissions', key: thread.key })).rejects.toThrow(
    'browser workspace',
  )
})

it('queues distinct local and remote link tabs until the workspace consumes them', async () => {
  const call = handler()
  const local = {
    id: 'external-one',
    title: '',
    url: 'https://example.com/work#section',
    kind: 'web',
    profileId: 'work',
  } as const
  const remote = {
    id: 'external-two',
    title: '',
    url: 'http://lan.test/path',
    kind: 'remote',
    profileId: 'remote-work',
    runtimeId: 'paired-computer',
  } as const
  await call(event, { action: 'open-tab', key: 'external:one', tab: local })
  await call(event, { action: 'open-tab', key: 'external:two', tab: remote })
  expect(mocks.create).toHaveBeenCalledOnce()
  expect(mocks.contents.loadURL).toHaveBeenCalledWith(local.url)
  await call(event, { action: 'status', key: 'thread-preview' })
  await expect(
    call(event, { action: 'status', key: 'workspace', tabCount: 1 }),
  ).resolves.toMatchObject({
    movedTabs: [
      { key: 'external:one', tab: local },
      { key: 'external:two', tab: remote },
    ],
  })
  await expect(
    call(event, { action: 'status', key: 'workspace', tabCount: 3 }),
  ).resolves.toMatchObject({ tabStates: [expect.objectContaining({ key: 'external:one' })] })
})

it('rejects unsafe and ownerless external destinations before creating a native page', async () => {
  const call = handler()
  const tab = {
    id: 'external',
    title: '',
    url: 'javascript:alert(1)',
    kind: 'web',
    profileId: 'work',
  }
  await expect(call(event, { action: 'open-tab', key: 'external', tab })).rejects.toThrow(
    'HTTP or HTTPS',
  )
  await expect(
    call(event, {
      action: 'open-tab',
      key: 'external',
      tab: { ...tab, url: 'https://example.com', kind: 'remote' },
    }),
  ).rejects.toThrow('Choose a computer')
  expect(mocks.create).not.toHaveBeenCalled()
})

it('retains an external tab and reports its background navigation failure when selected', async () => {
  const call = handler()
  mocks.contents.loadURL.mockRejectedValueOnce(new Error('net::ERR_CONNECTION_REFUSED'))
  const tab = {
    id: 'failed-link',
    title: '',
    url: 'http://unavailable.local/',
    kind: 'web',
    profileId: 'work',
  }
  await call(event, { action: 'open-tab', key: 'external:failed', tab })
  // Let the hidden load finish before the browser workspace consumes its handoff.
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await expect(
    call(event, { action: 'status', key: 'workspace', tabCount: 1 }),
  ).resolves.toMatchObject({
    movedTabs: [{ key: 'external:failed', tab }],
  })
  await expect(call(event, { action: 'status', key: 'external:failed' })).rejects.toThrow(
    'net::ERR_CONNECTION_REFUSED',
  )
  expect(mocks.contents.close).not.toHaveBeenCalled()
})

it('accepts one-use PiP tickets only from the owning main frame and protects their call tab', async () => {
  const call = handler()
  await call(event, workspaceShow)
  const authorize = mocks.contents.ipc.handle.mock.calls.find(
    ([name]) => name === 'browser:document-pip-authorize',
  )?.[1]
  if (typeof authorize !== 'function') throw new Error('Missing Document PiP authorization')
  expect(authorize({ senderFrame: {} }, true, false)).toBeNull()
  const name = authorize({ senderFrame: mocks.contents.mainFrame }, true, false)
  const details = {
    url: 'about:blank',
    frameName: name,
    disposition: 'new-window',
    features: 'popup,width=420,height=280',
  }
  const result = openHandler()(details)
  expect(result).toMatchObject({
    action: 'allow',
    overrideBrowserWindowOptions: {
      alwaysOnTop: true,
      frame: false,
      width: 420,
      height: 316,
      webPreferences: { sandbox: true, nodeIntegration: false },
    },
  })
  expect(openHandler()(details)).toEqual({ action: 'deny' })
  const popup = popupWindow()
  mocks.pipWindow.mockReturnValue({ window: popup as never, contents: popup.webContents as never })
  expect(result.createWindow?.({})).toBe(popup.webContents)
  expect(mocks.pipWindow).toHaveBeenCalledWith({}, 'https://example.com/', expect.any(Function))
  expect(popup.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating')
  expect(popup.setVisibleOnAllWorkspaces.mock.calls).toEqual(
    process.platform === 'linux' ? [[true]] : [],
  )
  popup.setAlwaysOnTop.mockClear()
  popup.on.mock.calls.find(([name]) => name === 'restore')?.[1]()
  expect(popup.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating')
  expect(await call(event, { action: 'tab-activity', key: 'activity' })).toHaveProperty(
    'protectedKeys',
    ['shared'],
  )
  expect(await call(event, { action: 'media-status', key: 'activity' })).toHaveProperty(
    'callTabs.0.pictureInPicture',
    true,
  )
  await call(event, { action: 'set-audio-muted', key: 'shared', muted: true })
  expect(mocks.contents.setAudioMuted).toHaveBeenCalledWith(true)
  expect(popup.webContents.setAudioMuted).toHaveBeenCalledWith(true)
  const closed = popup.once.mock.calls.find(([name]) => name === 'closed')?.[1]
  closed?.()
  expect(await call(event, { action: 'tab-activity', key: 'activity' })).toHaveProperty(
    'protectedKeys',
    [],
  )
})

it('reports background tab activity, validates frame reports, and mutes without selecting the tab', async () => {
  const call = handler()
  await call(event, workspaceShow)
  const devices = mocks.contents.ipc.on.mock.calls.find(
    ([name]) => name === 'browser:tab-devices',
  )?.[1]
  const badge = mocks.contents.ipc.on.mock.calls.find(([name]) => name === 'browser:tab-badge')?.[1]
  if (typeof devices !== 'function' || typeof badge !== 'function')
    throw new Error('Missing activity listeners')
  const main = { senderFrame: mocks.contents.mainFrame }
  devices(main, { camera: true, microphone: true, screenSharing: true })
  badge(main, 7)
  devices({ senderFrame: {} }, { camera: false, microphone: false, screenSharing: false })
  badge({ senderFrame: {} }, 99)
  mocks.contents.isCurrentlyAudible.mockReturnValue(true)
  await call(event, { action: 'hide', key: workspaceShow.key })
  const status = await call(event, { action: 'status', key: 'workspace', tabCount: 1 })
  expect(status).toMatchObject({
    tabStates: [
      {
        key: workspaceShow.key,
        badge: 7,
        camera: true,
        microphone: true,
        screenSharing: true,
        audible: true,
        muted: false,
      },
    ],
  })
  mocks.window.focus.mockClear()
  const muted = await call(event, {
    action: 'set-audio-muted',
    key: workspaceShow.key,
    muted: true,
  })
  expect(muted).toMatchObject({ tabStates: [expect.objectContaining({ muted: true })] })
  expect(mocks.contents.setAudioMuted).toHaveBeenCalledWith(true)
  expect(mocks.window.focus).not.toHaveBeenCalled()
  devices(main, { camera: false, microphone: false, screenSharing: false })
  badge(main, null)
  expect(await call(event, { action: 'status', key: 'workspace', tabCount: 1 })).toMatchObject({
    tabStates: [
      expect.objectContaining({
        camera: false,
        microphone: false,
        screenSharing: false,
        badge: undefined,
      }),
    ],
  })
  await call(event, { ...workspaceShow, key: 'preview', workspaceBrowser: false })
  await expect(
    call(event, { action: 'set-audio-muted', key: 'preview', muted: true }),
  ).rejects.toThrow('Browser workspace')
})

function workspaceTarget(id: number) {
  return {
    ...mocks.window,
    id,
    once: vi.fn<typeof mocks.window.once>(),
    on: vi.fn<typeof mocks.window.on>(),
    contentView: {
      ...mocks.window.contentView,
      children: [] as unknown[],
      addChildView: vi.fn<typeof mocks.window.contentView.addChildView>(),
      removeChildView: vi.fn<typeof mocks.window.contentView.removeChildView>(),
    },
    webContents: {
      ...mocks.window.webContents,
      on: vi.fn<typeof mocks.window.webContents.on>(),
      send: vi.fn<typeof mocks.window.webContents.send>(),
    },
  }
}
const placeholderState = {
  action: 'sync-tabs' as const,
  key: 'workspace',
  activeId: 'empty',
  tabs: [
    {
      key: 'empty-key',
      tab: {
        id: 'empty',
        url: '',
        title: '',
        kind: 'web' as const,
        profileId: 'default',
      },
    },
  ],
}

it('detaches and returns pinned, sleeping and remote tabs without replacing the live page', async () => {
  const target = workspaceTarget(2)
  const create = vi.fn<() => Promise<import('electron').BrowserWindow>>(async () => {
    mocks.windowFor = target
    await call(event, placeholderState)
    mocks.windowFor = undefined
    return target as never
  })
  const bridge = registerBrowser('/app/index.html', undefined, undefined, {
    create,
    list: () => [target as never],
    main: async () => mocks.window as never,
  })
  registrations.push(bridge)
  const call = mocks.handle.mock.calls.at(-1)![1]
  const tabs = [
    {
      key: 'shared',
      tab: {
        id: 'pinned',
        title: 'Pinned',
        url: 'https://example.com/',
        kind: 'web',
        profileId: 'default',
        pinned: true,
        homeUrl: 'https://example.com/',
        keepAwake: true,
      },
    },
    {
      key: 'asleep-key',
      tab: {
        id: 'asleep',
        title: 'Read later',
        url: 'http://lan.local/',
        kind: 'web',
        profileId: 'work',
        settledAt: 100,
        keepAwake: false,
      },
    },
    {
      key: 'remote-key',
      tab: {
        id: 'remote',
        title: 'Remote app',
        url: 'http://vpn.local/',
        kind: 'remote',
        profileId: 'default',
        runtimeId: 'server',
        snoozedUntil: Date.now() + 60000,
      },
    },
  ]
  await call(event, { ...placeholderState, tabs, activeId: 'pinned' })
  await call(event, { ...workspaceShow, keepAwake: true })
  const loads = mocks.contents.loadURL.mock.calls.length
  mocks.media.keepAlive.mockReturnValue(true)
  await call(event, { action: 'detach-tabs', key: 'workspace', tabs, activeId: 'pinned' })
  expect(create).toHaveBeenCalledOnce()
  expect(mocks.create).toHaveBeenCalledOnce()
  expect(mocks.media.moveTab).toHaveBeenCalledWith(mocks.contents, 2)
  expect(mocks.contents.close).not.toHaveBeenCalled()
  mocks.windowFor = target
  const detached = await call(event, { action: 'status', key: 'shared', tabCount: 3 })
  expect(detached).toMatchObject({
    movedTabs: [{ key: 'shared', tab: { ...tabs[0].tab, title: 'Example' } }, tabs[1], tabs[2]],
    focusedTabKey: 'shared',
  })
  // Close immediately after event delivery, before the destination renderer can sync again.
  const returning = bridge.returnWindowTabs(target as never)
  expect(bridge.returnWindowTabs(target as never)).toBe(returning)
  let saved = false
  void returning.then(() => {
    saved = true
  })
  await vi.waitFor(() => expect(mocks.media.moveTab).toHaveBeenLastCalledWith(mocks.contents, 1))
  mocks.windowFor = undefined
  await call(event, {
    action: 'sync-tabs',
    key: 'workspace',
    tabs,
    activeId: 'pinned',
    persisted: false,
  })
  expect(saved).toBe(false)
  await call(event, {
    action: 'sync-tabs',
    key: 'workspace',
    tabs,
    activeId: 'pinned',
    persisted: true,
  })
  await returning
  const closed = target.once.mock.calls.find(([name]) => name === 'closed')![1]
  closed()
  expect(mocks.contents.close).not.toHaveBeenCalled()
  mocks.windowFor = undefined
  expect(await call(event, { action: 'status', key: 'shared', tabCount: 0 })).toMatchObject({
    movedTabs: [{ key: 'shared', tab: { ...tabs[0].tab, title: 'Example' } }, tabs[1], tabs[2]],
    focusedTabKey: 'shared',
  })
  await call(event, { ...workspaceShow, keepAwake: true })
  expect(mocks.create).toHaveBeenCalledOnce()
  expect(mocks.contents.loadURL).toHaveBeenCalledTimes(loads)
})

it('waits for the main workspace to restore before returning an extra window', async () => {
  const target = workspaceTarget(2)
  const bridge = registerBrowser('/app/index.html', undefined, undefined, {
    create: async () => target as never,
    list: () => [target as never],
    main: async () => mocks.window as never,
  })
  registrations.push(bridge)
  const call = mocks.handle.mock.calls.at(-1)![1]
  mocks.windowFor = target
  const tab = {
    id: 'remote',
    url: 'http://lan.local/',
    title: 'Remote',
    kind: 'remote',
    runtimeId: 'server',
    profileId: 'work',
    pinned: true,
  }
  await call(event, {
    action: 'sync-tabs',
    key: 'workspace',
    activeId: 'remote',
    tabs: [{ key: 'remote-key', tab }],
  })
  const returning = bridge.returnWindowTabs(target as never)
  await vi.waitFor(() =>
    expect(mocks.window.webContents.send).toHaveBeenCalledWith('browser:focus-workspace'),
  )
  mocks.windowFor = undefined
  await call(event, placeholderState)
  await vi.waitFor(() =>
    expect(
      mocks.window.webContents.send.mock.calls.filter(
        ([name]) => name === 'browser:focus-workspace',
      ),
    ).toHaveLength(2),
  )
  await call(event, {
    action: 'sync-tabs',
    key: 'workspace',
    activeId: 'remote',
    tabs: [{ key: 'remote-key', tab }],
    persisted: true,
  })
  await returning
  expect(await call(event, { action: 'status', key: 'empty-key', tabCount: 1 })).toMatchObject({
    movedTabs: [{ key: 'remote-key', tab }],
  })
})

it('preserves the detached workspace if returning would exceed the main tab limit', async () => {
  const target = workspaceTarget(2)
  const bridge = registerBrowser('/app/index.html', undefined, undefined, {
    create: async () => target as never,
    list: () => [target as never],
    main: async () => mocks.window as never,
  })
  registrations.push(bridge)
  const call = mocks.handle.mock.calls.at(-1)![1]
  const tabs = Array.from({ length: 100 }, (_, i) => ({
    key: `main-${i}`,
    tab: {
      id: `main-${i}`,
      title: 'Page',
      url: 'https://example.com/',
      kind: 'web',
      profileId: 'default',
    },
  }))
  await call(event, { action: 'sync-tabs', key: 'workspace', tabs, activeId: 'main-0' })
  mocks.windowFor = target
  await call(event, workspaceShow)
  await call(event, {
    action: 'sync-tabs',
    key: 'workspace',
    activeId: 'extra',
    tabs: [
      {
        key: 'shared',
        tab: {
          id: 'extra',
          url: 'https://example.com/',
          title: 'Extra',
          kind: 'web',
          profileId: 'default',
          pinned: true,
        },
      },
    ],
  })
  await expect(bridge.returnWindowTabs(target as never)).rejects.toThrow('limit 100')
  expect(mocks.contents.close).not.toHaveBeenCalled()
  expect(mocks.media.moveTab).not.toHaveBeenCalled()
  expect(await call(event, { action: 'status', key: 'shared' })).toHaveProperty(
    'url',
    'https://example.com/',
  )
})

it.each(['show', 'keep-awake'] as const)(
  'cancels pending %s when its tab is detached before creation completes',
  async (action) => {
    const target = workspaceTarget(2)
    let finish = () => {}
    const bridge = registerBrowser('/app/index.html', undefined, undefined, {
      create: async () => target as never,
      list: () => [target as never],
    })
    registrations.push(bridge)
    const call = mocks.handle.mock.calls.at(-1)![1]
    mocks.windowFor = target
    await call(event, placeholderState)
    mocks.windowFor = undefined
    mocks.extensions.prepare.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const tab = {
      id: 'restoring',
      title: 'Gmail',
      url: 'https://mail.google.com/',
      kind: 'web',
      profileId: 'default',
    }
    const restoring = call(event, {
      ...workspaceShow,
      action,
      key: 'restoring-key',
      url: tab.url,
      profileId: 'default',
    })
    await call(event, {
      action: 'detach-tabs',
      key: 'workspace',
      activeId: 'restoring',
      tabs: [{ key: 'restoring-key', tab }],
    })
    finish()
    await restoring
    expect(mocks.create).not.toHaveBeenCalled()
    mocks.windowFor = target
    expect(await call(event, { action: 'status', key: 'empty-key', tabCount: 1 })).toMatchObject({
      movedTabs: [{ key: 'restoring-key', tab }],
    })
  },
)
