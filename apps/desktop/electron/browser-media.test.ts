import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const f = vi.hoisted(() => ({
  userData: '',
  frames: new Map<unknown, unknown>(),
  access: vi.fn<(type: string) => string>(() => 'granted'),
  remote: vi.fn<typeof import('./browser-remote-media').openRemoteMedia>(),
  desktop: vi.fn<() => Promise<unknown[]>>(async () => []),
  ask: vi.fn<(type: string) => Promise<boolean>>(async () => true),
}))
vi.mock('electron', () => ({
  app: { getPath: () => f.userData },
  desktopCapturer: { getSources: f.desktop },
  systemPreferences: { getMediaAccessStatus: f.access, askForMediaAccess: f.ask },
  webContents: { fromFrame: (frame: unknown) => f.frames.get(frame) },
}))
vi.mock('./browser-remote-media.js', () => ({ openRemoteMedia: f.remote }))
vi.mock('./browser-screen-permission.js', () => ({ prepareScreenRecording: async () => true }))
import { createBrowserMedia, type MediaTab } from './browser-media'

type Listener = (...args: unknown[]) => void
function page(id: number, url: string) {
  const ipc = new Map<string, Listener>()
  const events = new Map<string, Listener>()
  const mainFrame: { url: string; parent: unknown; processId: number; routingId: number } = {
    url,
    parent: null,
    processId: id,
    routingId: 1,
  }
  const state = { destroyed: false, captured: false, audible: false }
  const contents = {
    id,
    state,
    isDestroyed: () => state.destroyed,
    isBeingCaptured: () => state.captured,
    isCurrentlyAudible: () => state.audible,
    mainFrame,
    getTitle: () => `Page ${id}`,
    getURL: () => mainFrame.url,
    send: vi.fn<(channel: string, ...args: unknown[]) => void>(),
    ipc: { on: (name: string, listener: Listener) => void ipc.set(name, listener) },
    on: (name: string, listener: Listener) => void events.set(name, listener),
    once: (name: string, listener: Listener) => void events.set(name, listener),
    report: (raw: unknown, frame: unknown = mainFrame) =>
      ipc.get('browser-media:track')?.({ senderFrame: frame }, raw),
    emit: (name: string, ...args: unknown[]) => events.get(name)?.(...args),
  }
  f.frames.set(mainFrame, contents)
  return contents
}
type Page = ReturnType<typeof page>
function fakeSession() {
  return {
    registerPreloadScript: vi.fn<(script: unknown) => void>(),
    display: undefined as undefined | Listener,
    request: undefined as undefined | Listener,
    check: undefined as undefined | ((...args: unknown[]) => boolean),
    setDisplayMediaRequestHandler(handler: Listener) {
      this.display = handler
    },
    setPermissionRequestHandler(handler: Listener) {
      this.request = handler
    },
    setPermissionCheckHandler(handler: (...args: unknown[]) => boolean) {
      this.check = handler
    },
  }
}

let root = ''
let tabs: MediaTab[] = []
const tab = (key: string, contents: Page, profileId = 'work', windowId = 1): MediaTab => ({
  key,
  windowId,
  profileId,
  contents: contents as never,
})
const host = {
  tabFor: (contents: { id: number }) => tabs.find((item) => item.contents.id === contents.id),
  canFullscreen: vi.fn<() => boolean>(() => true),
  prepareFullscreen: vi.fn<() => void>(),
  tabs: () => tabs,
}
beforeEach(async () => {
  vi.clearAllMocks()
  host.canFullscreen.mockReturnValue(true)
  root = await mkdtemp(join(tmpdir(), 'dovo-browser-media-'))
  f.userData = root
  f.frames.clear()
  tabs = []
})
afterEach(async () => {
  vi.useRealTimers()
  await rm(root, { recursive: true, force: true })
})
function setup() {
  const media = createBrowserMedia(host as never)
  const session = fakeSession()
  media.attachSession(session as never, 'work')
  const call = page(1, 'https://meet.example/abc')
  const shared = page(2, 'https://docs.example/doc')
  const personal = page(3, 'https://other.example/')
  tabs = [tab('call', call), tab('docs', shared), tab('personal', personal, 'personal')]
  for (const contents of [call, shared, personal]) media.attachTab(contents as never)
  return { media, session, call, shared, personal }
}
const share = (
  session: ReturnType<typeof fakeSession>,
  frame: unknown,
  overrides: Record<string, unknown> = {},
) => {
  const callback = vi.fn<(streams: unknown) => void>()
  session.display?.(
    {
      frame,
      securityOrigin: 'https://meet.example/',
      videoRequested: true,
      audioRequested: true,
      userGesture: true,
      ...overrides,
    },
    callback,
  )
  return callback
}

it('installs the capture preload and handlers once per shared-browser session', async () => {
  const media = createBrowserMedia(host as never)
  const session = fakeSession()
  media.attachSession(session as never, 'work')
  media.attachSession(session as never, 'work')
  expect(session.registerPreloadScript).toHaveBeenCalledOnce()
  const [{ filePath, type }] = session.registerPreloadScript.mock.calls[0] as [
    { filePath: string; type: string },
  ]
  expect(type).toBe('frame')
  const preload = await readFile(filePath, 'utf8')
  expect(preload).toContain('process.isMainFrame')
  expect(preload).toContain('const apply = Reflect.apply')
  expect(preload).toContain('const devices = MediaDevices.prototype')
  expect(preload).toContain('const stopTrack = MediaStreamTrack.prototype.stop')
  // The page side may name a capture for Stop, but never reports one as ended.
  expect(preload).toContain("apply(readyState, tracks[index], []) === 'live'")
  expect(preload).not.toContain('loopback')
})

it('allows fullscreen only for owned web tabs while retaining the activation requirement', () => {
  const { session, call, personal } = setup()
  const answer = vi.fn<(allowed: unknown) => void>()
  session.request?.(call, 'fullscreen', answer, {
    isMainFrame: true,
    requestingUrl: call.mainFrame.url,
  })
  expect(answer).toHaveBeenLastCalledWith(true)
  session.request?.(call, 'fullscreen', answer, {
    isMainFrame: false,
    requestingUrl: 'https://embedded.example/video',
  })
  expect(answer).toHaveBeenLastCalledWith(true)
  session.request?.(personal, 'fullscreen', answer, {
    isMainFrame: true,
    requestingUrl: personal.mainFrame.url,
  })
  expect(answer).toHaveBeenLastCalledWith(false)
  session.request?.(call, 'fullscreen', answer, { isMainFrame: true, requestingUrl: 'file:///x' })
  expect(answer).toHaveBeenLastCalledWith(false)
  expect(session.check?.(call, 'fullscreen', 'https://embedded.example', {})).toBe(true)
  expect(session.check?.(call, 'automatic-fullscreen', call.mainFrame.url, {})).toBe(false)
  host.canFullscreen.mockReturnValue(false)
  session.request?.(call, 'fullscreen', answer, {
    isMainFrame: true,
    requestingUrl: call.mainFrame.url,
  })
  expect(answer).toHaveBeenLastCalledWith(false)
  expect(session.check?.(call, 'fullscreen', call.mainFrame.url, {})).toBe(false)
})

it('queues a display request without choosing anything, listing tabs across profiles', () => {
  const { media, session, call } = setup()
  const callback = share(session, call.mainFrame)
  expect(callback).not.toHaveBeenCalled()
  const { mediaRequests } = media.snapshot(1)
  expect(mediaRequests).toEqual([
    {
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      kind: 'display',
      key: 'call',
      profileId: 'work',
      origin: 'https://meet.example',
      video: true,
      audio: true,
      expiresAt: expect.any(Number),
      sources: [
        {
          key: 'call',
          title: 'Page 1',
          url: 'https://meet.example/abc',
          requester: true,
          profileId: 'work',
          kind: 'tab',
          audioSupported: true,
        },
        {
          key: 'docs',
          title: 'Page 2',
          url: 'https://docs.example/doc',
          requester: false,
          profileId: 'work',
          kind: 'tab',
          audioSupported: true,
        },
        {
          key: 'personal',
          title: 'Page 3',
          url: 'https://other.example/',
          requester: false,
          profileId: 'personal',
          kind: 'tab',
          audioSupported: true,
        },
      ],
    },
  ])
  expect(media.snapshot(2)).toEqual({})
})

it('refuses display requests without a gesture, from frames, other profiles or mismatched origins', () => {
  const { media, session, call, personal } = setup()
  const subframe = { url: 'https://meet.example/frame', parent: call.mainFrame }
  f.frames.set(subframe, call)
  for (const [frame, overrides] of [
    [call.mainFrame, { userGesture: false }],
    [call.mainFrame, { videoRequested: false }],
    [call.mainFrame, { securityOrigin: 'https://evil.example/' }],
    [subframe, {}],
    [null, {}],
    [personal.mainFrame, { securityOrigin: 'https://other.example/' }],
  ] as const)
    expect(share(session, frame, overrides)).toHaveBeenCalledWith(null)
  const unknown = page(9, 'https://meet.example/')
  expect(share(session, unknown.mainFrame)).toHaveBeenCalledWith(null)
  call.mainFrame.url = 'file:///etc/passwd'
  expect(share(session, call.mainFrame, { securityOrigin: 'file:///' })).toHaveBeenCalledWith(null)
  expect(media.snapshot(1)).toEqual({})
})

it('shares the chosen whole tab with its own audio, never system loopback', async () => {
  const { media, session, call, shared } = setup()
  const callback = share(session, call.mainFrame)
  const [request] = media.snapshot(1).mediaRequests!
  await expect(
    media.decide(1, { key: 'call', requestId: request!.id, decision: 'allow', source: 'missing' }),
  ).rejects.toThrow('Choose an available tab')
  await media.decide(1, {
    key: 'call',
    requestId: request!.id,
    decision: 'allow',
    source: 'docs',
    audio: true,
  })
  expect(callback).toHaveBeenCalledWith({
    video: shared.mainFrame,
    audio: shared.mainFrame,
    enableLocalEcho: true,
  })
  expect(media.snapshot(1)).toEqual({
    captures: [
      {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        key: 'call',
        sourceKey: 'docs',
        sourceTitle: 'Page 2',
        sourceUrl: 'https://docs.example/doc',
        profileId: 'work',
        origin: 'https://meet.example',
        audio: true,
        state: 'starting',
      },
    ],
  })
})

it('shares video only when audio was not asked for, and refuses audio the page never requested', async () => {
  const { media, session, call, shared } = setup()
  const callback = share(session, call.mainFrame, { audioRequested: false })
  const [request] = media.snapshot(1).mediaRequests!
  await expect(
    media.decide(1, {
      key: 'call',
      requestId: request!.id,
      decision: 'allow',
      source: 'docs',
      audio: true,
    }),
  ).rejects.toThrow('did not ask for tab audio')
  await media.decide(1, { key: 'call', requestId: request!.id, decision: 'allow', source: 'docs' })
  expect(callback).toHaveBeenCalledWith({ video: shared.mainFrame })
})

it('denies on cancel, on a changed page, on a wrong window and when the request expires', async () => {
  vi.useFakeTimers()
  const { media, session, call } = setup()
  const cancelled = share(session, call.mainFrame)
  const [first] = media.snapshot(1).mediaRequests!
  await expect(
    media.decide(2, { key: 'call', requestId: first!.id, decision: 'deny' }),
  ).rejects.toThrow('no longer waiting')
  await media.decide(1, { key: 'call', requestId: first!.id, decision: 'deny' })
  expect(cancelled).toHaveBeenCalledWith(null)
  const navigated = share(session, call.mainFrame)
  const [second] = media.snapshot(1).mediaRequests!
  call.mainFrame.url = 'https://evil.example/'
  await expect(
    media.decide(1, { key: 'call', requestId: second!.id, decision: 'allow', source: 'docs' }),
  ).rejects.toThrow('The page changed before you answered')
  expect(navigated).toHaveBeenCalledWith(null)
  call.mainFrame.url = 'https://meet.example/abc'
  const expiring = share(session, call.mainFrame)
  await vi.advanceTimersByTimeAsync(59_999)
  expect(expiring).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(expiring).toHaveBeenCalledWith(null)
  expect(media.snapshot(1)).toEqual({})
})

it('keeps one display request per tab and at most six per window', () => {
  const { media, session, call } = setup()
  const older = share(session, call.mainFrame)
  share(session, call.mainFrame)
  expect(older).toHaveBeenCalledWith(null)
  expect(media.snapshot(1).mediaRequests).toHaveLength(1)
  const callers = Array.from({ length: 6 }, (_, index) => {
    const contents = page(10 + index, 'https://meet.example/')
    tabs.push(tab(`caller-${index}`, contents))
    return share(session, contents.mainFrame)
  })
  expect(media.snapshot(1).mediaRequests).toHaveLength(6)
  expect(callers.at(-1)).toHaveBeenCalledWith(null)
})

it('lists captures by Chromium’s count on the shared tab, never by page reports alone', async () => {
  vi.useFakeTimers()
  const { media, session, call, shared } = setup()
  share(session, call.mainFrame)
  const [request] = media.snapshot(1).mediaRequests!
  await media.decide(1, {
    key: 'call',
    requestId: request!.id,
    decision: 'allow',
    source: 'docs',
    audio: true,
  })
  const [capture] = media.snapshot(1).captures!
  expect(capture!.state).toBe('starting')
  // A page report cannot make a capture active, and only the approved main frame is heard.
  call.report(
    { phase: 'started', id: '1', kinds: ['video', 'audio'] },
    { processId: 99, routingId: 1 },
  )
  call.report({ phase: 'started', id: '1', kinds: ['video', 'audio'] })
  expect(media.snapshot(1).captures![0]!.state).toBe('starting')
  shared.state.captured = true
  expect(media.snapshot(1).captures![0]!.state).toBe('active')
  // Forged endings or failures are ignored while Chromium still counts the tab as captured.
  call.report({ phase: 'ended', id: '1', kinds: [] })
  call.report({ phase: 'failed', id: '', kinds: [] })
  expect(media.snapshot(1).captures).toHaveLength(1)
  expect(() => media.stop(1, { key: 'other', captureId: capture!.id })).toThrow(
    'no longer being shared',
  )
  media.stop(1, { key: 'call', captureId: capture!.id })
  expect(call.send).toHaveBeenCalledWith('browser-media:stop', '1')
  expect(media.snapshot(1).captures![0]).toMatchObject({ state: 'stopping' })
  expect(media.snapshot(1).captures![0]).not.toHaveProperty('unresponsive')
  await vi.advanceTimersByTimeAsync(5000)
  expect(media.snapshot(1).captures![0]).toMatchObject({ state: 'stopping', unresponsive: true })
  shared.state.captured = false
  expect(media.snapshot(1)).toEqual({})
})

it('moves capture controls with the calling tab without ending tracks or losing device grants', async () => {
  const { media, session, call, shared } = setup()
  const answer = vi.fn<(allowed: boolean) => void>()
  session.request?.(call, 'media', answer, {
    isMainFrame: true,
    mediaTypes: ['audio'],
    requestingUrl: call.mainFrame.url,
  })
  const [devices] = media.snapshot(1).mediaRequests!
  await media.decide(1, { key: 'call', requestId: devices!.id, decision: 'allow' })
  share(session, call.mainFrame)
  const [request] = media.snapshot(1).mediaRequests!
  await media.decide(1, { key: 'call', requestId: request!.id, decision: 'allow', source: 'docs' })
  call.report({ phase: 'started', id: '1', kinds: ['video', 'audio'] })
  shared.state.captured = true
  const [capture] = media.snapshot(1).captures!
  // Moving the shared source alone does not move the caller’s controls or stop its capture.
  tabs[1]!.windowId = 2
  media.moveTab(shared as never, 2)
  expect(media.snapshot(1).captures![0]!.id).toBe(capture!.id)
  expect(media.snapshot(2)).toEqual({})
  tabs[0]!.windowId = 2
  media.moveTab(call as never, 2)
  media.releaseWindow(1)
  expect(media.snapshot(1)).toEqual({})
  expect(media.snapshot(2).captures).toEqual([capture])
  expect(media.keepAlive(call as never)).toBe(true)
  expect(call.send).not.toHaveBeenCalledWith('browser-media:stop', expect.anything())
  session.request?.(call, 'media', answer, {
    isMainFrame: true,
    mediaTypes: ['audio'],
    requestingUrl: call.mainFrame.url,
  })
  expect(answer).toHaveBeenLastCalledWith(true)
  expect(media.snapshot(2).mediaRequests).toBeUndefined()
  expect(() => media.stop(1, { key: 'call', captureId: capture!.id })).toThrow(
    'no longer being shared',
  )
  media.stop(2, { key: 'call', captureId: capture!.id })
  expect(call.send).toHaveBeenCalledWith('browser-media:stop', '1')
})

it('moves a waiting media prompt so only its new window can answer', async () => {
  const { media, session, call } = setup()
  const callback = share(session, call.mainFrame)
  const [request] = media.snapshot(1).mediaRequests!
  tabs[0]!.windowId = 2
  media.moveTab(call as never, 2)
  expect(media.snapshot(1).mediaRequests).toBeUndefined()
  expect(media.snapshot(2).mediaRequests![0]!.id).toBe(request!.id)
  await expect(
    media.decide(1, { key: 'call', requestId: request!.id, decision: 'allow', source: 'docs' }),
  ).rejects.toThrow('no longer waiting')
  expect(callback).not.toHaveBeenCalled()
  await media.decide(2, { key: 'call', requestId: request!.id, decision: 'allow', source: 'docs' })
  expect(callback).toHaveBeenCalledWith(expect.objectContaining({ video: expect.anything() }))
})

it('cannot stop a page that bypassed the tracker, and says so instead of claiming it stopped', async () => {
  const { media, session, call, shared } = setup()
  share(session, call.mainFrame)
  const [request] = media.snapshot(1).mediaRequests!
  await media.decide(1, { key: 'call', requestId: request!.id, decision: 'allow', source: 'docs' })
  const [capture] = media.snapshot(1).captures!
  expect(() => media.stop(1, { key: 'call', captureId: capture!.id })).toThrow(
    'not started sharing yet',
  )
  shared.state.captured = true
  expect(() => media.stop(1, { key: 'call', captureId: capture!.id })).toThrow(
    'Close the page to stop it',
  )
  expect(call.send).not.toHaveBeenCalled()
  expect(media.snapshot(1).captures![0]).toMatchObject({ state: 'active', unresponsive: true })
})

it('keeps a capture through page navigation until Chromium ends it, and drops one never started', async () => {
  vi.useFakeTimers()
  const { media, session, call, shared } = setup()
  const approve = async () => {
    share(session, call.mainFrame)
    const [request] = media.snapshot(1).mediaRequests!
    await media.decide(1, {
      key: 'call',
      requestId: request!.id,
      decision: 'allow',
      source: 'docs',
    })
  }
  await approve()
  await vi.advanceTimersByTimeAsync(9_999)
  expect(media.snapshot(1).captures).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(media.snapshot(1)).toEqual({})
  await approve()
  shared.state.captured = true
  const pending = share(session, call.mainFrame)
  call.emit('did-navigate')
  expect(pending).toHaveBeenCalledWith(null)
  expect(media.snapshot(1).captures).toHaveLength(1)
  shared.state.destroyed = true
  expect(media.snapshot(1)).toEqual({})
})

it('asks before camera or microphone use, remembers the live document, and resets on opt-out', async () => {
  const { media, session, call, personal } = setup()
  const ask = (contents: Page, mediaTypes: string[], isMainFrame = true) => {
    const callback = vi.fn<(allowed: boolean) => void>()
    session.request?.(contents, 'media', callback, {
      isMainFrame,
      mediaTypes,
      requestingUrl: contents.mainFrame.url,
    })
    return callback
  }
  const camera = ask(call, ['audio', 'video'])
  expect(camera).not.toHaveBeenCalled()
  const [request] = media.snapshot(1).mediaRequests!
  expect(request).toMatchObject({ kind: 'user-media', audio: true, video: true, key: 'call' })
  expect(request).not.toHaveProperty('sources')
  await media.decide(1, { key: 'call', requestId: request!.id, decision: 'allow' })
  expect(camera).toHaveBeenCalledWith(true)
  expect(ask(call, ['audio'])).toHaveBeenCalledWith(true)
  expect(media.keepAlive(call as never)).toBe(true)
  expect(session.check?.(call, 'media', 'https://meet.example/', { mediaType: 'video' })).toBe(true)
  expect(session.check?.(call, 'media', 'https://evil.example/', { mediaType: 'video' })).toBe(
    false,
  )
  expect(ask(call, ['audio'], false)).toHaveBeenCalledWith(false)
  expect(ask(call, ['screen'])).toHaveBeenCalledWith(false)
  expect(ask(personal, ['audio'])).toHaveBeenCalledWith(false)
  const sameOrigin = page(21, call.mainFrame.url)
  tabs.push(tab('same-origin', sameOrigin))
  const separate = ask(sameOrigin, ['audio'])
  expect(separate).not.toHaveBeenCalled()
  const extraRequest = media.snapshot(1).mediaRequests!.find((item) => item.key === 'same-origin')!
  await media.decide(1, { key: 'same-origin', requestId: extraRequest.id, decision: 'deny' })
  expect(separate).toHaveBeenCalledWith(false)
  call.emit('did-navigate')
  expect(session.check?.(call, 'media', 'https://meet.example/', { mediaType: 'video' })).toBe(
    false,
  )
  const geolocation = vi.fn<(allowed: boolean) => void>()
  session.request?.(call, 'geolocation', geolocation, {
    isMainFrame: true,
    requestingUrl: call.mainFrame.url,
  })
  expect(geolocation).toHaveBeenCalledWith(false)
  // Opt-out forgets the answer: the same origin has to ask again, and pending asks are denied.
  media.reset()
  const after = ask(call, ['audio'])
  expect(after).not.toHaveBeenCalled()
  media.reset()
  expect(after).toHaveBeenCalledWith(false)
})

it('lets getDisplayMedia reach the display handler only for the tab’s own page origin', () => {
  const { session, call } = setup()
  const display = vi.fn<(allowed: boolean) => void>()
  session.request?.(call, 'display-capture', display, {
    isMainFrame: true,
    requestingUrl: call.mainFrame.url,
  })
  expect(display).toHaveBeenCalledWith(true)
  expect(session.check?.(call, 'display-capture', 'https://meet.example/', {})).toBe(true)
  expect(session.check?.(call, 'display-capture', 'https://evil.example/', {})).toBe(false)
  const stranger = page(20, 'https://meet.example/')
  expect(session.check?.(stranger, 'display-capture', 'https://meet.example/', {})).toBe(false)
})

it('remembers only explicitly approved devices for the exact website and profile across restart', async () => {
  const { media, session, call } = setup()
  const ask = (contents: Page, mediaTypes: string[]) => {
    const callback = vi.fn<(allowed: boolean) => void>()
    session.request?.(contents, 'media', callback, {
      isMainFrame: true,
      mediaTypes,
      requestingUrl: contents.mainFrame.url,
    })
    return callback
  }
  const mic = ask(call, ['audio'])
  const [request] = media.snapshot(1).mediaRequests!
  await media.decide(1, { key: 'call', requestId: request!.id, decision: 'allow', remember: true })
  expect(mic).toHaveBeenCalledWith(true)
  media.reset()
  expect(ask(call, ['audio'])).toHaveBeenCalledWith(true)
  expect(session.check?.(call, 'media', call.mainFrame.url, { mediaType: 'audio' })).toBe(true)
  expect(session.check?.(call, 'media', call.mainFrame.url, { mediaType: 'video' })).toBe(false)
  const camera = ask(call, ['audio', 'video'])
  expect(camera).not.toHaveBeenCalled()
  const [cameraRequest] = media.snapshot(1).mediaRequests!
  await media.decide(1, { key: 'call', requestId: cameraRequest!.id, decision: 'deny' })
  expect(camera).toHaveBeenCalledWith(false)
  expect(ask(call, ['video'])).not.toHaveBeenCalled()
  media.reset()
  call.mainFrame.url = 'https://other.example/'
  expect(ask(call, ['audio'])).not.toHaveBeenCalled()
  media.reset()
})

it('asks macOS for camera and microphone access before granting', async () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  try {
    const { media, session, call } = setup()
    f.access.mockReturnValue('not-determined')
    f.ask.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const callback = vi.fn<(allowed: boolean) => void>()
    session.request?.(call, 'media', callback, {
      isMainFrame: true,
      mediaTypes: ['audio', 'video'],
      requestingUrl: call.mainFrame.url,
    })
    const [request] = media.snapshot(1).mediaRequests!
    await expect(
      media.decide(1, { key: 'call', requestId: request!.id, decision: 'allow' }),
    ).rejects.toThrow('macOS has not allowed Dovo to use the microphone')
    expect(f.ask.mock.calls).toEqual([['camera'], ['microphone']])
    expect(callback).toHaveBeenCalledWith(false)
  } finally {
    Object.defineProperty(process, 'platform', platform)
    f.access.mockReturnValue('granted')
  }
})

it('serializes tracker association and reserves each source for one capture', async () => {
  const { media, session, call, shared } = setup()
  share(session, call.mainFrame)
  const [first] = media.snapshot(1).mediaRequests!
  await media.decide(1, { key: 'call', requestId: first!.id, decision: 'allow', source: 'docs' })
  const another = page(30, 'https://meet.example/other')
  tabs.push(tab('other-call', another))
  media.attachTab(another as never)
  share(session, another.mainFrame)
  const [other] = media.snapshot(1).mediaRequests!
  await expect(
    media.decide(1, { key: 'other-call', requestId: other!.id, decision: 'allow', source: 'docs' }),
  ).rejects.toThrow('already being shared')
  share(session, call.mainFrame)
  const next = media.snapshot(1).mediaRequests!.find((request) => request.key === 'call')!
  await expect(
    media.decide(1, { key: 'call', requestId: next.id, decision: 'allow', source: 'call' }),
  ).rejects.toThrow('previous share to start')
  call.report({ phase: 'started', id: '1' })
  shared.state.captured = true
  await media.decide(1, { key: 'call', requestId: next.id, decision: 'allow', source: 'call' })
  call.report({ phase: 'started', id: '2' })
  call.state.captured = true
  const captures = media.snapshot(1).captures!
  expect(captures).toHaveLength(2)
  media.stop(1, {
    key: 'call',
    captureId: captures.find((capture) => capture.sourceKey === 'call')!.id,
  })
  expect(call.send).toHaveBeenCalledWith('browser-media:stop', '2')
  call.state.captured = false
  expect(media.snapshot(1).captures).toHaveLength(1)
  media.reset()
})

it('retains pending calls, approved document devices, captured sources and audible tabs', async () => {
  const { media, session, call, shared, personal } = setup()
  expect(media.keepAlive(call as never)).toBe(false)
  personal.state.audible = true
  expect(media.keepAlive(personal as never)).toBe(true)
  share(session, call.mainFrame)
  expect(media.keepAlive(call as never)).toBe(true)
  const [request] = media.snapshot(1).mediaRequests!
  await media.decide(1, { key: 'call', requestId: request!.id, decision: 'allow', source: 'docs' })
  expect(media.keepAlive(call as never)).toBe(true)
  expect(media.keepAlive(shared as never)).toBe(true)
  shared.state.captured = true
  media.snapshot(1)
  shared.state.captured = false
  expect(media.keepAlive(call as never)).toBe(false)
  const answer = vi.fn<(allowed: boolean) => void>()
  session.request?.(call, 'media', answer, {
    isMainFrame: true,
    mediaTypes: ['audio'],
    requestingUrl: call.mainFrame.url,
  })
  const [devices] = media.snapshot(1).mediaRequests!
  await media.decide(1, { key: 'call', requestId: devices!.id, decision: 'allow' })
  expect(media.keepAlive(call as never)).toBe(true)
  call.emit('did-start-navigation', {}, call.mainFrame.url, false, true)
  expect(media.keepAlive(call as never)).toBe(true)
  call.emit('did-navigate')
  expect(media.keepAlive(call as never)).toBe(false)
})

it('excludes extension pages from shareable sources', () => {
  const { media, session, call } = setup()
  tabs.push(tab('extension', page(31, 'chrome-extension://example/options.html')))
  share(session, call.mainFrame)
  expect(media.snapshot(1).mediaRequests![0]!.sources!.map((source) => source.key)).toEqual([
    'call',
    'docs',
    'personal',
  ])
  media.reset()
})

it('captures an explicitly selected tab from another profile', async () => {
  const { media, session, call, personal } = setup()
  const callback = share(session, call.mainFrame)
  const [request] = media.snapshot(1).mediaRequests!
  await media.decide(1, {
    key: 'call',
    requestId: request!.id,
    decision: 'allow',
    source: 'personal',
    audio: true,
  })
  expect(callback).toHaveBeenCalledWith({
    video: personal.mainFrame,
    audio: personal.mainFrame,
    enableLocalEcho: true,
  })
})

it('requires website approval for notifications and retains it only for that origin/profile', async () => {
  const { media, session, call } = setup()
  const ask = vi.fn<(allow: boolean) => void>()
  session.request?.(call, 'notifications', ask, {
    isMainFrame: true,
    requestingUrl: call.mainFrame.url,
  })
  expect(ask).not.toHaveBeenCalled()
  expect(session.check?.(call, 'notifications', 'https://meet.example', {})).toBe(false)
  const [request] = media.snapshot(1).mediaRequests!
  expect(request!.kind).toBe('notifications')
  await media.decide(1, { key: 'call', requestId: request!.id, decision: 'allow' })
  expect(ask).toHaveBeenCalledWith(true)
  call.emit('did-navigate')
  expect(session.check?.(call, 'notifications', 'https://meet.example', {})).toBe(true)
  expect(session.check?.(null, 'notifications', 'https://meet.example', {})).toBe(true)
  expect(session.check?.(call, 'notifications', 'https://other.example', {})).toBe(false)
  expect(session.check?.(null, 'notifications', 'https://other.example', {})).toBe(false)
  const denied = page(40, 'https://denied.example')
  tabs.push(tab('denied', denied))
  const deny = vi.fn<(allow: boolean) => void>()
  session.request?.(denied, 'notifications', deny, {
    isMainFrame: true,
    requestingUrl: denied.mainFrame.url,
  })
  const [second] = media.snapshot(1).mediaRequests!
  await media.decide(1, { key: 'denied', requestId: second!.id, decision: 'deny' })
  expect(deny).toHaveBeenCalledWith(false)
  expect(session.check?.(denied, 'notifications', 'https://denied.example', {})).toBe(false)
  session.request?.(denied, 'notifications', deny, {
    isMainFrame: true,
    requestingUrl: denied.mainFrame.url,
  })
  expect(media.snapshot(1).mediaRequests).toBeUndefined()
})

it('offers desktop windows and screens only after enumeration and stops their real tracks', async () => {
  f.desktop.mockResolvedValueOnce([
    {
      id: 'window:12:0',
      name: 'Editor',
      thumbnail: { toDataURL: () => 'data:image/png;base64,AA==' },
    },
    {
      id: 'screen:0:0',
      name: 'Screen 1',
      thumbnail: { toDataURL: () => 'data:image/png;base64,AA==' },
    },
  ])
  const { media, session, call } = setup()
  const callback = share(session, call.mainFrame)
  await vi.waitFor(() => expect(media.snapshot(1).mediaRequests![0]!.sources).toHaveLength(5))
  const [request] = media.snapshot(1).mediaRequests!
  expect(request!.sources).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ key: 'window:12:0', kind: 'window', audioSupported: false }),
      expect.objectContaining({ key: 'screen:0:0', kind: 'screen', audioSupported: false }),
    ]),
  )
  await expect(
    media.decide(1, {
      key: 'call',
      requestId: request!.id,
      decision: 'allow',
      source: 'window:12:0',
      audio: true,
    }),
  ).rejects.toThrow('local browser tabs only')
  await media.decide(1, {
    key: 'call',
    requestId: request!.id,
    decision: 'allow',
    source: 'window:12:0',
  })
  expect(callback).toHaveBeenCalledWith({ video: expect.objectContaining({ id: 'window:12:0' }) })
  call.report({ phase: 'started', id: '1' })
  const [capture] = media.snapshot(1).captures!
  expect(capture).toMatchObject({ state: 'active', sourceKind: 'window', sourceTitle: 'Editor' })
  media.stop(1, { key: 'call', captureId: capture!.id })
  expect(call.send).toHaveBeenCalledWith('browser-media:stop', '1')
  call.report({ phase: 'ended', id: '1' })
  expect(media.snapshot(1)).toEqual({})
})

it('opens only the chosen remote source, isolates its window and cleans up when tracks end', async () => {
  const { media, session, call } = setup()
  const source = page(50, 'data:text/html,remote')
  const close = vi.fn<() => void>()
  f.remote.mockResolvedValueOnce({ contents: source as never, close })
  const remote = {
    key: 'remote-tab',
    tabId: 'tab-id',
    profileId: 'remote-profile',
    title: 'Remote',
    url: 'http://lan.example',
    connection: { address: 'http://runtime.example', token: 'paired-device-token-long-enough' },
  }
  media.setRemoteSources(1, [remote])
  expect(media.snapshot(2)).toEqual({})
  const callback = share(session, call.mainFrame)
  expect(f.remote).not.toHaveBeenCalled()
  const [request] = media.snapshot(1).mediaRequests!
  expect(request!.sources).toEqual(
    expect.arrayContaining([expect.objectContaining({ key: 'remote-tab', kind: 'remote' })]),
  )
  await media.decide(1, {
    key: 'call',
    requestId: request!.id,
    decision: 'allow',
    source: 'remote-tab',
  })
  expect(f.remote).toHaveBeenCalledWith(remote)
  expect(callback).toHaveBeenCalledWith({ video: source.mainFrame })
  source.state.captured = true
  expect(media.snapshot(1).captures![0]).toMatchObject({
    sourceKind: 'remote',
    sourceUrl: remote.url,
  })
  source.state.captured = false
  expect(media.snapshot(1)).toEqual({})
  expect(close).toHaveBeenCalledOnce()
})

it('opens a dedicated presentation only after an explicit thread choice', async () => {
  const { call } = setup()
  const source = page(60, 'file:///studio/index.html#thread-share=fixture')
  const close = vi.fn<() => void>()
  const openThread = vi.fn<NonNullable<import('./browser-media').MediaHost['openThread']>>(
    async () => ({ contents: source as never, close }),
  )
  const media = createBrowserMedia({ ...host, openThread })
  const newSession = fakeSession()
  media.attachSession(newSession as never, 'work')
  media.setThreadSources(1, [{ runtimeId: 'computer', taskId: 'thread', title: 'Fix bug' }])
  const callback = share(newSession, call.mainFrame)
  const [request] = media.snapshot(1).mediaRequests!
  expect(openThread).not.toHaveBeenCalled()
  await media.decide(1, {
    key: 'call',
    requestId: request!.id,
    decision: 'allow',
    source: 'thread:computer:thread',
  })
  expect(callback).toHaveBeenCalledWith({ video: source.mainFrame })
  expect(openThread).toHaveBeenCalledWith({
    runtimeId: 'computer',
    taskId: 'thread',
    title: 'Fix bug',
  })
  expect(media.snapshot(1).captures![0]).toMatchObject({
    sourceKind: 'thread',
    sourceTitle: 'Fix bug',
    sourceUrl: undefined,
  })
  media.reset()
  expect(close).toHaveBeenCalledOnce()
})

it('applies saved website blocks and revocation before document grants and prompts again after reset', async () => {
  const { browserPermissions } = await import('./browser-permissions')
  const { media, session, call } = setup()
  const origin = 'https://meet.example'
  const permissions = browserPermissions('work')
  permissions.allowMedia(origin, { audio: true, video: true })
  permissions.setSite(origin, 'camera', 'block')
  const video = vi.fn<(allow: boolean) => void>()
  session.request?.(call, 'media', video, {
    isMainFrame: true,
    requestingUrl: call.mainFrame.url,
    mediaTypes: ['video'],
  })
  expect(video).toHaveBeenCalledWith(false)
  expect(session.check?.(call, 'media', origin, { mediaType: 'video' })).toBe(false)
  expect(session.check?.(call, 'media', origin, { mediaType: 'audio' })).toBe(true)
  permissions.setSite(origin, 'microphone', 'ask')
  media.revokeSite('work', origin)
  const audio = vi.fn<(allow: boolean) => void>()
  session.request?.(call, 'media', audio, {
    isMainFrame: true,
    requestingUrl: call.mainFrame.url,
    mediaTypes: ['audio'],
  })
  expect(audio).not.toHaveBeenCalled()
  expect(media.snapshot(1).mediaRequests).toHaveLength(1)
  media.revokeSite('work', origin)
  expect(audio).toHaveBeenCalledWith(false)
  expect(media.snapshot(1).mediaRequests).toBeUndefined()
})

it.each([
  'clipboard-read',
  'clipboard-sanitized-write',
  'speaker-selection',
  'screen-wake-lock',
  'persistent-storage',
])('limits native %s access to the owned profile and top-level origin', async (permission) => {
  const { session, call, personal } = setup()
  const { browserPermissions } = await import('./browser-permissions')
  // Native permission names are also validated website-control names.
  const settings = browserPermissions('work')
  const known = [
    'clipboard-read',
    'clipboard-sanitized-write',
    'speaker-selection',
    'screen-wake-lock',
    'persistent-storage',
  ] as const
  const checked = known.find((name) => name === permission)
  if (!checked) throw new Error('Unknown fixture permission')
  settings.setSite('https://meet.example', checked, 'allow')
  expect(session.check?.(call, permission, 'https://meet.example', { isMainFrame: true })).toBe(
    true,
  )
  expect(session.check?.(call, permission, 'https://meet.example', { isMainFrame: false })).toBe(
    false,
  )
  expect(session.check?.(call, permission, 'https://evil.example', { isMainFrame: true })).toBe(
    false,
  )
  expect(
    session.check?.(personal, permission, 'https://other.example', { isMainFrame: true }),
  ).toBe(false)
  const callback = vi.fn<(allowed: boolean) => void>()
  session.request?.(call, permission, callback, {
    requestingUrl: 'https://evil.example',
    isMainFrame: true,
  })
  expect(callback).toHaveBeenCalledWith(false)
})
