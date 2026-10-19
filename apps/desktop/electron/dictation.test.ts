import { beforeEach, expect, it, vi } from 'vite-plus/test'

const f = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  permissions: new Map<string, (...args: unknown[]) => unknown>(),
  install: vi.fn<(signal: AbortSignal) => Promise<void>>(),
  transcribe: vi.fn<(pcm: ArrayBuffer, signal: AbortSignal) => Promise<string>>(),
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
    transcribe = f.transcribe
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
  registerDictation(path, '/bundle', '/data')
  await Promise.resolve()
})

it('rejects untrusted senders and subframes before exposing local state or starting work', async () => {
  expect(() => call('status', event(1, 'https://untrusted.test'))).toThrow('Untrusted')
  const child = event()
  child.senderFrame = { url: 'file:///dovo/index.html' }
  expect(() => call('status', child)).toThrow('Untrusted')
  await expect(call('install', event(), '../bad')).rejects.toThrow('Invalid')
  await expect(call('transcribe', event(), 'valid-id', 'not audio')).rejects.toThrow('Invalid')
  expect(f.install).not.toHaveBeenCalled()
  expect(f.transcribe).not.toHaveBeenCalled()
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
