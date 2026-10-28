import { beforeEach, expect, it, vi } from 'vite-plus/test'

const state = vi.hoisted(() => ({
  directories: new Map<string, number>(),
  files: new Map<string, { data: string; time: number }>(),
  nextId: 0,
  available: true,
  failWrite: false,
  share: vi.fn<(uri: string, options: { mimeType: string }) => Promise<void>>(),
}))

vi.mock('@dovo/protocol', () => ({ randomUUID: () => `export-${++state.nextId}` }))
vi.mock('expo-sharing', () => ({
  isAvailableAsync: async () => state.available,
  shareAsync: state.share,
}))
vi.mock('expo-file-system', () => {
  const path = (parts: (string | Directory)[]) =>
    parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/')
  class Directory {
    uri: string
    constructor(...parts: (string | Directory)[]) {
      this.uri = path(parts)
    }
    get exists() {
      return state.directories.has(this.uri)
    }
    create() {
      state.directories.set(this.uri, Date.now())
      state.directories.set(this.uri.slice(0, this.uri.lastIndexOf('/')), Date.now())
    }
    list() {
      return [...state.directories.keys()]
        .filter(
          (uri) => uri.startsWith(`${this.uri}/`) && !uri.slice(this.uri.length + 1).includes('/'),
        )
        .map((uri) => new Directory(uri))
    }
    info() {
      return { modificationTime: state.directories.get(this.uri) }
    }
    delete() {
      state.directories.delete(this.uri)
      for (const uri of state.files.keys())
        if (uri.startsWith(`${this.uri}/`)) state.files.delete(uri)
    }
  }
  class File {
    uri: string
    constructor(...parts: (string | Directory)[]) {
      this.uri = path(parts)
    }
    get exists() {
      return state.files.has(this.uri)
    }
    async write(data: string) {
      await Promise.resolve()
      if (state.failWrite) throw new Error('write failed')
      state.files.set(this.uri, { data, time: Date.now() })
    }
    info() {
      return { modificationTime: state.files.get(this.uri)?.time }
    }
  }
  return { Directory, File, Paths: { cache: '/cache' } }
})

import { shareAttachment } from './attachment-share'

const root = '/cache/attachment-share-exports'
beforeEach(() => {
  state.directories.clear()
  state.files.clear()
  state.nextId = 0
  state.available = true
  state.failWrite = false
  state.share.mockReset().mockResolvedValue(undefined)
  vi.useRealTimers()
})

it('retains unique exports after the chooser returns and prunes only old exports', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  state.directories.set('/cache/unrelated', 0)
  await shareAttachment('photo.png', 'image/png', 'first')
  await shareAttachment('photo.png', 'image/png', 'second')
  expect(state.share).toHaveBeenNthCalledWith(1, `${root}/export-1/photo.png`, {
    mimeType: 'image/png',
  })
  expect(state.files.get(`${root}/export-1/photo.png`)?.data).toBe('first')
  expect(state.files.get(`${root}/export-2/photo.png`)?.data).toBe('second')
  vi.advanceTimersByTime(24 * 60 * 60 * 1000)
  await shareAttachment('../other.txt', 'text/plain', 'third')
  expect(state.directories.has(`${root}/export-1`)).toBe(false)
  expect(state.directories.has(`${root}/export-2`)).toBe(false)
  expect(state.directories.has('/cache/unrelated')).toBe(true)
  expect(state.share).toHaveBeenLastCalledWith(`${root}/export-3/.._other.txt`, {
    mimeType: 'text/plain',
  })
})

it('keeps an active export even when another share prunes old files', async () => {
  vi.useFakeTimers()
  let finish = () => {}
  state.share.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const pending = shareAttachment('first.txt', 'text/plain', 'first')
  await vi.waitFor(() => expect(state.share).toHaveBeenCalledTimes(1))
  vi.advanceTimersByTime(2 * 24 * 60 * 60 * 1000)
  await shareAttachment('second.txt', 'text/plain', 'second')
  expect(state.files.has(`${root}/export-1/first.txt`)).toBe(true)
  finish()
  await pending
  await shareAttachment('third.txt', 'text/plain', 'third')
  expect(state.files.has(`${root}/export-1/first.txt`)).toBe(true)
})

it('removes failed exports and propagates write and share errors', async () => {
  state.failWrite = true
  await expect(shareAttachment('file.txt', 'text/plain', 'data')).rejects.toThrow('write failed')
  expect(state.share).not.toHaveBeenCalled()
  expect(state.directories.has(`${root}/export-1`)).toBe(false)
  state.failWrite = false
  state.share.mockRejectedValueOnce(new Error('share failed'))
  await expect(shareAttachment('file.txt', 'text/plain', 'data')).rejects.toThrow('share failed')
  expect(state.directories.has(`${root}/export-2`)).toBe(false)
  state.available = false
  await expect(shareAttachment('file.txt', 'text/plain', 'data')).rejects.toThrow('unavailable')
  expect(state.nextId).toBe(2)
})

it('uses the persisted retention marker after a restart', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  await shareAttachment('.shared', 'text/plain', 'data')
  expect(state.files.get(`${root}/export-1/_shared`)?.data).toBe('data')
  vi.resetModules()
  const restarted = await import('./attachment-share')
  vi.advanceTimersByTime(23 * 60 * 60 * 1000)
  await restarted.shareAttachment('next.txt', 'text/plain', 'next')
  expect(state.files.has(`${root}/export-1/_shared`)).toBe(true)
  vi.advanceTimersByTime(60 * 60 * 1000)
  await restarted.shareAttachment('last.txt', 'text/plain', 'last')
  expect(state.directories.has(`${root}/export-1`)).toBe(false)
})
