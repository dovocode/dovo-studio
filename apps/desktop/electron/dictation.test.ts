import { beforeEach, expect, it, vi } from 'vite-plus/test'

const f = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  permissions: new Map<string, (...args: unknown[]) => unknown>(),
  install: vi.fn<(signal: AbortSignal) => Promise<void>>(),
  start:
    vi.fn<
      (
        language: import('@dovo/protocol').DictationLanguage,
        signal: AbortSignal,
        onText: (text: string) => void,
      ) => Promise<import('./dictation-engine.js').DictationSession>
    >(),
  feed: vi.fn<(pcm: ArrayBuffer) => Promise<void>>(),
  finish: vi.fn<() => Promise<string>>(),
  status: vi.fn<() => Promise<import('@dovo/protocol').DictationStatus>>(async () => ({
    engine: true,
    model: false,
    downloading: false,
    downloaded: 0,
  })),
}))
vi.mock('electron', () => ({
  app: { whenReady: () => Promise.resolve() },
  ipcMain: {
    handle: (name: string, fn: (...args: unknown[]) => unknown) => f.handlers.set(name, fn),
  },
  session: {
    defaultSession: {
      setPermissionCheckHandler: (fn: (...args: unknown[]) => unknown) =>
        f.permissions.set('check', fn),
      setPermissionRequestHandler: (fn: (...args: unknown[]) => unknown) =>
        f.permissions.set('request', fn),
    },
  },
  systemPreferences: { askForMediaAccess: async () => true },
}))
vi.mock('./dictation-engine.js', () => ({
  DictationEngine: class {
    status = f.status
    install = f.install
    start = f.start
  },
}))
import { registerDictation } from './dictation.js'

const path = '/dovo/index.html'
function event(id = 1, url = 'file:///dovo/index.html') {
  const frame = { url }
  return {
    senderFrame: frame,
    sender: {
      id,
      mainFrame: frame,
      once: vi.fn<(...args: unknown[]) => void>(),
      on: vi.fn<(...args: unknown[]) => void>(),
      removeListener: vi.fn<(...args: unknown[]) => void>(),
      getURL: () => url,
      isDestroyed: () => false,
      send: vi.fn<(...args: unknown[]) => void>(),
    },
  }
}
function call(name: string, ...args: unknown[]) {
  const handler = f.handlers.get(`dictation:${name}`)
  if (!handler) throw new Error(`Missing handler ${name}`)
  return handler(...args)
}
beforeEach(async () => {
  vi.clearAllMocks()
  f.feed.mockResolvedValue()
  f.start.mockImplementation(async (_language, signal, onText) => {
    const completed = Promise.withResolvers<void>()
    signal.addEventListener('abort', () => completed.resolve(), { once: true })
    f.finish.mockImplementation(async () => {
      completed.resolve()
      return 'Final transcript.'
    })
    onText('Live preview')
    return { feed: f.feed, finish: f.finish, done: completed.promise }
  })
  registerDictation(path, '/bundle', '/data')
  await Promise.resolve()
})

it('rejects untrusted senders and subframes before exposing local state or starting work', async () => {
  expect(() => call('status', event(1, 'https://untrusted.test'))).toThrow('Untrusted')
  const child = event()
  child.senderFrame = { url: 'file:///dovo/index.html' }
  expect(() => call('status', child)).toThrow('Untrusted')
  await expect(call('install', event(), '../bad')).rejects.toThrow('Invalid')
  await expect(call('start', event(), 'valid-id', 'not-a-locale')).rejects.toThrow('Expected')
  expect(() => call('feed', event(), 'valid-id', 'not audio')).toThrow('no longer active')
  expect(f.install).not.toHaveBeenCalled()
  expect(f.start).not.toHaveBeenCalled()
})

it('only lets the owning window and session cancel work, retaining ownership until it ends', async () => {
  let signal: AbortSignal | undefined
  let finish: (() => void) | undefined
  f.install.mockImplementation((value) => {
    signal = value
    return new Promise((resolve) => {
      finish = resolve
    })
  })
  const running = call('install', event(), 'owner')
  await call('cancel', event(2), 'owner')
  await call('cancel', event(), 'other-session')
  expect(signal?.aborted).toBe(false)
  await expect(call('install', event(2), 'second')).rejects.toThrow('Another')
  const stopping = call('cancel', event(), 'owner')
  expect(signal?.aborted).toBe(true)
  await expect(call('install', event(), 'replacement')).rejects.toThrow('Another')
  finish?.()
  await running
  await stopping
  f.install.mockResolvedValueOnce()
  await call('install', event(), 'fresh')
})

it('allows microphone checks only for the trusted main document and denies cameras and embedded documents', () => {
  const check = f.permissions.get('check')
  const sender = event().sender
  expect(
    check?.(sender, 'media', 'file://', {
      mediaType: 'audio',
      isMainFrame: true,
      requestingUrl: 'file:///dovo/index.html',
    }),
  ).toBe(true)
  expect(
    check?.(sender, 'media', 'file://', {
      mediaType: 'video',
      isMainFrame: true,
      requestingUrl: 'file:///dovo/index.html',
    }),
  ).toBe(false)
  expect(
    check?.(sender, 'media', 'file://', {
      mediaType: 'audio',
      isMainFrame: false,
      requestingUrl: 'file:///dovo/index.html',
    }),
  ).toBe(false)
  const respond = vi.fn<(allowed: boolean) => void>()
  f.permissions.get('request')?.(sender, 'media', respond, {
    mediaTypes: ['audio'],
    isMainFrame: false,
    requestingUrl: 'https://untrusted.test',
  })
  expect(respond).toHaveBeenCalledWith(false)
  expect(check?.(sender, 'clipboard-sanitized-write', 'file://', {})).toBe(true)
})

it('keeps streaming audio, preview and finalization scoped to the owning window', async () => {
  const owner = event()
  await call('start', owner, 'recording', 'nl-NL')
  expect(f.start.mock.calls[0]?.[0]).toBe('nl-NL')
  expect(owner.sender.send).toHaveBeenCalledWith('dictation:update', 'recording', {
    type: 'text',
    text: 'Live preview',
  })
  expect(() => call('feed', event(2), 'recording', new ArrayBuffer(640))).toThrow(
    'no longer active',
  )
  expect(() => call('finish', event(), 'wrong-id')).toThrow('no longer active')
  expect(() => call('feed', owner, 'recording', 'not audio')).toThrow('Invalid')
  await call('feed', owner, 'recording', new ArrayBuffer(640))
  expect(f.feed).toHaveBeenCalledOnce()
  await expect(call('install', event(2), 'download')).rejects.toThrow('Another')
  expect(await call('finish', owner, 'recording')).toBe('Final transcript.')
  await call('cancel', owner, 'recording')
  expect(() => call('feed', owner, 'recording', new ArrayBuffer(640))).toThrow('no longer active')
})

it('cancels while the model is loading and rejects a late start', async () => {
  f.start.mockImplementation(
    (_language, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true })
      }),
  )
  const starting = call('start', event(), 'loading', 'auto')
  const stopping = call('cancel', event(), 'loading')
  await expect(starting).rejects.toThrow('Cancelled')
  await stopping
})
