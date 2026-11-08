import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
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
