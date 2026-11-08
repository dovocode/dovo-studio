import { beforeEach, expect, it, vi } from 'vite-plus/test'

const state = vi.hoisted(() => ({
  directories: new Set<string>(),
  times: new Map<string, number>(),
  files: new Map<string, number>(),
  nextId: 0,
  status: 200,
  size: 4,
  share: vi.fn<(uri: string) => Promise<void>>(),
  cancel: vi.fn<() => Promise<void>>(),
  run: vi.fn<(path: string) => Promise<{ status: number } | undefined>>(),
}))
vi.mock('@dovo/protocol', () => ({
  BROWSER_DOWNLOAD_MAX_BYTES: 50 * 1024 * 1024,
}))
vi.mock('expo-crypto', () => ({ randomUUID: () => `unique-${++state.nextId}` }))
vi.mock('expo-sharing', () => ({ isAvailableAsync: async () => true, shareAsync: state.share }))
vi.mock('expo-file-system', () => {
  class Directory {
    uri: string
    constructor(...parts: (string | Directory)[]) {
      this.uri = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/')
    }
    get exists() {
      return state.directories.has(this.uri)
    }
    create() {
      state.directories.add(this.uri)
      state.directories.add(this.uri.slice(0, this.uri.lastIndexOf('/')))
      state.times.set(this.uri, Date.now())
    }
    list() {
      return [...state.directories]
        .filter(
          (uri) => uri.startsWith(`${this.uri}/`) && !uri.slice(this.uri.length + 1).includes('/'),
        )
        .map((uri) => new Directory(uri))
    }
    info() {
      return {
        modificationTime: state.times.get(this.uri),
        size: [...state.files]
          .filter(([uri]) => uri.startsWith(`${this.uri}/`))
          .reduce((total, [, size]) => total + size, 0),
      }
    }
    delete() {
      state.directories.delete(this.uri)
      for (const key of state.files.keys())
        if (key.startsWith(this.uri + '/')) state.files.delete(key)
    }
  }
  class File {
    uri: string
    constructor(directory: Directory, name: string) {
      this.uri = `${directory.uri}/${name}`
    }
    get exists() {
      return state.files.has(this.uri)
    }
    get size() {
      return state.files.get(this.uri)
    }
  }
  return { Directory, File, Paths: { cache: '/cache' } }
})
vi.mock('expo-file-system/legacy', () => ({
  createDownloadResumable: (_url: string, path: string) => ({
    cancelAsync: state.cancel,
    downloadAsync: () => state.run(path),
  }),
}))
import { shareBrowserDownload } from './browser-download'

const options = () => ({
  url: 'http://runtime.test/api/previews/browser/download/grant',
  origin: 'http://runtime.test',
  name: '../report.csv',
  size: 4,
  signal: new AbortController().signal,
})
beforeEach(() => {
  state.directories.clear()
  state.times.clear()
  state.files.clear()
  state.nextId = 0
  state.status = 200
  state.size = 4
  state.share.mockReset().mockResolvedValue(undefined)
  state.cancel.mockReset().mockResolvedValue(undefined)
  state.run.mockReset().mockImplementation(async (path: string) => {
    state.files.set(path, state.size)
    return { status: state.status }
  })
})
it('streams to a sanitized file and shares it', async () => {
  await shareBrowserDownload(options())
  expect(state.share).toHaveBeenCalledWith('/cache/browser-download-exports/unique-1/.._report.csv')
})
it('rejects untrusted origins and incomplete transfers', async () => {
  await expect(
    shareBrowserDownload({
      ...options(),
      url: 'http://evil.test/api/previews/browser/download/grant',
    }),
  ).rejects.toThrow('Invalid browser download address')
  await expect(shareBrowserDownload({ ...options(), size: 50 * 1024 * 1024 + 1 })).rejects.toThrow(
    'Invalid browser download size',
  )
  state.size = 3
  await expect(shareBrowserDownload(options())).rejects.toThrow('incomplete')
  expect(state.directories.has('/cache/browser-download-exports/unique-1')).toBe(false)
  expect(state.share).not.toHaveBeenCalled()
})
it('cancels and removes a transfer when the viewer becomes stale', async () => {
  let finish: (value: undefined) => void = () => {}
  state.run.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const controller = new AbortController()
  const pending = shareBrowserDownload({ ...options(), signal: controller.signal })
  await vi.waitFor(() => expect(state.run).toHaveBeenCalled())
  controller.abort()
  finish(undefined)
  await expect(pending).rejects.toThrow('cancelled')
  expect(state.cancel).toHaveBeenCalledOnce()
  expect(state.directories.has('/cache/browser-download-exports/unique-1')).toBe(false)
  expect(state.share).not.toHaveBeenCalled()
})
it('limits concurrent saves and keeps active exports reserved', async () => {
  const finish: ((value: undefined) => void)[] = []
  state.run.mockImplementation(() => new Promise((resolve) => finish.push(resolve)))
  const first = shareBrowserDownload(options())
  const second = shareBrowserDownload(options())
  await vi.waitFor(() => expect(state.run).toHaveBeenCalledTimes(2))
  await expect(shareBrowserDownload(options())).rejects.toThrow('Two browser downloads')
  finish.forEach((resolve) => resolve(undefined))
  await Promise.allSettled([first, second])
})
it('bounds retained exports without deleting recent shared files', async () => {
  const root = '/cache/browser-download-exports'
  state.directories.add(root)
  for (let index = 0; index < 10; index++) {
    const directory = `${root}/old-${index}`
    state.directories.add(directory)
    state.times.set(directory, Date.now())
    state.files.set(`${directory}/report`, 4)
  }
  await expect(shareBrowserDownload(options())).rejects.toThrow('cache is full')
  state.times.set(`${root}/old-0`, Date.now() - 24 * 60 * 60 * 1000)
  await shareBrowserDownload(options())
  expect(state.directories.has(`${root}/old-0`)).toBe(false)
  expect(state.directories.has(`${root}/old-1`)).toBe(true)
})
it('bounds retained bytes before starting a transfer', async () => {
  const root = '/cache/browser-download-exports'
  const directory = `${root}/retained`
  state.directories.add(root)
  state.directories.add(directory)
  state.times.set(directory, Date.now())
  state.files.set(`${directory}/report`, 100 * 1024 * 1024 - 3)
  await expect(shareBrowserDownload(options())).rejects.toThrow('cache is full')
  expect(state.run).not.toHaveBeenCalled()
  expect(state.directories.has(directory)).toBe(true)
})
