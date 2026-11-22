import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
const f = vi.hoisted(() => ({ root: '', windows: [] as unknown[] }))
vi.mock('electron', () => ({
  app: { getPath: () => f.root },
  shell: {},
  BrowserWindow: class {
    webContents = { downloadURL: () => {} }
    constructor() {
      f.windows.push(this.webContents)
    }
    isDestroyed() {
      return false
    }
    destroy() {}
  },
}))
import { createBrowserDownloads } from './browser-downloads'
const trackers: Array<ReturnType<typeof createBrowserDownloads>> = []
beforeEach(async () => {
  f.root = await mkdtemp(join(tmpdir(), 'dovo-downloads-'))
})
afterEach(async () => {
  for (const tracker of trackers.splice(0)) tracker.dispose()
  await rm(f.root, { recursive: true, force: true })
})
function profile(id: string) {
  const session = new EventEmitter()
  const tracker = createBrowserDownloads(session as Electron.Session, id, () => {})
  trackers.push(tracker)
  return { session, tracker }
}
function item(fail = false) {
  let path = ''
  const native = Object.assign(new EventEmitter(), {
    getFilename: () => 'report.csv',
    getSavePath: () => path,
    setSavePath: (value: string) => {
      if (fail) throw new Error('save path failed')
      path = value
    },
    getURL: () => 'https://example.test/report.csv',
    getURLChain: () => [],
    getMimeType: () => 'text/csv',
    getStartTime: () => 0,
    isPaused: () => false,
    canResume: () => false,
    getReceivedBytes: () => 0,
    getTotalBytes: () => 0,
    cancel: () => {},
  })
  return native
}
async function start(
  fixture: ReturnType<typeof profile>,
  native: ReturnType<typeof item>,
  filename = 'report.csv',
) {
  const request = fixture.tracker.download({
    url: 'https://example.test/report.csv',
    filename,
  })
  fixture.session.emit('will-download', {}, native, f.windows.at(-1))
  return request
}
it('reserves pending destinations across profiles and keeps ownership after profile disposal', async () => {
  const work = profile('work'),
    personal = profile('personal')
  const first = item(),
    second = item(),
    third = item(),
    fourth = item()
  await start(work, first)
  await start(personal, second)
  expect(first.getSavePath()).toBe(join(f.root, 'report.csv'))
  expect(second.getSavePath()).toBe(join(f.root, 'report (1).csv'))
  work.tracker.dispose()
  await start(personal, third)
  expect(third.getSavePath()).toBe(join(f.root, 'report (2).csv'))
  first.emit('done', {}, 'cancelled')
  await start(personal, fourth)
  expect(fourth.getSavePath()).toBe(join(f.root, 'report.csv'))
  for (const native of [second, third, fourth]) native.emit('done', {}, 'cancelled')
})

it.skipIf(process.platform === 'win32')(
  'reserves destinations shared through directory symlinks',
  async () => {
    await mkdir(join(f.root, 'actual'))
    await symlink(join(f.root, 'actual'), join(f.root, 'alias'))
    const work = profile('work'),
      personal = profile('personal')
    const first = item(),
      second = item()
    await start(work, first, 'actual/report.csv')
    await start(personal, second, 'alias/report.csv')
    expect(second.getSavePath()).toBe(join(f.root, 'alias/report (1).csv'))
    first.emit('done', {}, 'cancelled')
    second.emit('done', {}, 'cancelled')
  },
)
it('releases a destination when native setup fails', async () => {
  const work = profile('work'),
    personal = profile('personal')
  await expect(start(work, item(true))).rejects.toThrow('save path failed')
  const next = item()
  await start(personal, next)
  expect(next.getSavePath()).toBe(join(f.root, 'report.csv'))
  next.emit('done', {}, 'cancelled')
})

it('preserves a different file at a saved download path after restart', async () => {
  const work = profile('work')
  const native = item()
  const id = await start(work, native)
  const path = native.getSavePath()
  await writeFile(path, 'original download')
  native.emit('done', {}, 'completed')
  work.tracker.dispose()
  await rm(path)
  await writeFile(path, 'replacement document')
  const restored = profile('work').tracker
  expect(() => restored.removeFile(id)).toThrow('original downloaded file could not be verified')
  expect(await readFile(path, 'utf8')).toBe('replacement document')
  expect(restored.erase({ id })).toEqual([id])
})

it('retains assigned native ownership through a setup and cancellation failure until done', async () => {
  const work = profile('work'),
    personal = profile('personal')
  const failed = item(),
    second = item(),
    third = item()
  vi.spyOn(failed, 'getMimeType').mockImplementation(() => {
    throw new Error('native metadata failed')
  })
  vi.spyOn(failed, 'cancel').mockImplementation(() => {
    throw new Error('native cancel failed')
  })
  await expect(start(work, failed)).rejects.toThrow('Download setup and cancellation failed')
  await start(personal, second)
  expect(second.getSavePath()).toBe(join(f.root, 'report (1).csv'))
  failed.emit('done', {}, 'cancelled')
  await start(personal, third)
  expect(third.getSavePath()).toBe(join(f.root, 'report.csv'))
  second.emit('done', {}, 'cancelled')
  third.emit('done', {}, 'cancelled')
})

it('filters by start and end instants, not by ISO string order', async () => {
  const work = profile('work')
  const native = item()
  await start(work, native)
  // The download starts at 1970-01-01T00:00:00.000Z. Both filters name the same instant
  // range in other forms that sort differently as strings.
  const ids = (query: Parameters<typeof work.tracker.search>[0]) =>
    work.tracker.search(query).map((download) => download.id)
  const [id] = ids({})
  expect(ids({ startedAfter: '1970-01-01T01:00:00+02:00' })).toEqual([id])
  expect(ids({ startedBefore: '1970-01-01T00:00:00.5Z' })).toEqual([id])
  expect(ids({ startedBefore: '1969-12-31T19:00:00-05:00' })).toEqual([])
  expect(ids({ endedAfter: '1970-01-01T00:00:00Z' })).toEqual([])
  expect(() => ids({ startedAfter: 'yesterday' })).toThrow('Invalid query filter')
  native.emit('done', {}, 'cancelled')
})

it('cancels a running private download when its profile closes, but not a saved profile download', async () => {
  const privateProfile = profile('private-00000000-0000-4000-8000-000000000000'),
    work = profile('work')
  const hidden = item(),
    saved = item()
  const cancelHidden = vi.spyOn(hidden, 'cancel'),
    cancelSaved = vi.spyOn(saved, 'cancel')
  await start(privateProfile, hidden)
  await start(work, saved)
  privateProfile.tracker.dispose()
  work.tracker.dispose()
  expect(cancelHidden).toHaveBeenCalledOnce()
  expect(cancelSaved).not.toHaveBeenCalled()
  hidden.emit('done', {}, 'cancelled')
  saved.emit('done', {}, 'cancelled')
})

it('keeps valid records from a damaged store and preserves the original', async () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
  const directory = join(f.root, 'browser-downloads')
  await mkdir(directory, { recursive: true })
  const record = {
    id: 4,
    url: 'https://example.test/kept.csv',
    finalUrl: 'https://example.test/kept.csv',
    filename: join(f.root, 'kept.csv'),
    mime: 'text/csv',
    startTime: '2026-01-01T00:00:00.000Z',
    endTime: '2026-01-01T00:00:01.000Z',
    state: 'complete',
    paused: false,
    canResume: false,
    danger: 'safe',
    bytesReceived: 1,
    totalBytes: 1,
    fileSize: 1,
    exists: true,
    incognito: false,
  }
  const damaged = JSON.stringify({ nextId: 9, items: [record, { id: 'broken' }] })
  await writeFile(join(directory, 'work.json'), damaged)
  const work = profile('work')
  expect(work.tracker.search({}).map((download) => download.id)).toEqual([4])
  const [backup] = (await readdir(directory)).filter((name) => name.includes('.damaged-'))
  expect(await readFile(join(directory, backup!), 'utf8')).toBe(damaged)
  // Erased IDs are not reused: the next ID survives recovery.
  const native = item()
  await expect(start(work, native)).resolves.toBe(9)
  native.emit('done', {}, 'cancelled')
  logged.mockRestore()
})
