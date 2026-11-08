import { EventEmitter } from 'node:events'
import { chmod, mkdtemp, open, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CDPSession } from 'playwright'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import type { RemoteBrowserDownload } from '@dovo/protocol'
import { BrowserDownloads } from './browser-downloads.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.useRealTimers()
})
const guid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'download-test-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const events = new EventEmitter()
  const send = vi
    .fn<CDPSession['send']>()
    .mockResolvedValue({ targetInfo: { browserContextId: 'context' } })
  // Only the CDP transport is replaced; filesystem and manager lifecycle are real.
  // Playwright's generic command/result relationship cannot be expressed by a
  // single mock return value. Keep this transport-only assertion at the boundary.
  const cdp = Object.assign(events, { send }) as unknown as CDPSession
  const publish =
    vi.fn<(message: RemoteBrowserDownload | { type: 'downloadRemoved'; id: string }) => void>()
  const failure = vi.fn<(message: string) => void>()
  const report = vi.fn<(error: unknown) => void>()
  const manager = new BrowserDownloads(cdp, directory, publish, failure, report)
  await manager.start()
  cleanups.push(() => manager.release())
  const begin = (n: number, name = 'report.csv') =>
    events.emit('Browser.downloadWillBegin', {
      guid: guid(n),
      url: 'http://lan/report',
      suggestedFilename: name,
    })
  const progress = (n: number, state: string, receivedBytes: number, totalBytes = receivedBytes) =>
    events.emit('Browser.downloadProgress', { guid: guid(n), state, receivedBytes, totalBytes })
  const complete = async (n: number, text = 'report') => {
    await writeFile(join(directory, guid(n)), text)
    progress(n, 'completed', Buffer.byteLength(text))
    await vi.waitFor(() =>
      expect(manager.messages().find((message) => message.id === guid(n))?.status).toBe('ready'),
    )
  }
  return { manager, directory, events, send, publish, failure, report, begin, progress, complete }
}

it('limits concurrent transfers and cancels oversized downloads including partial files', async () => {
  const f = await fixture()
  f.begin(1)
  f.begin(2)
  f.begin(3)
  expect(f.manager.messages().map((message) => message.id)).toEqual([guid(1), guid(2)])
  expect(f.send).toHaveBeenCalledWith('Browser.cancelDownload', {
    guid: guid(3),
    browserContextId: 'context',
  })
  await writeFile(join(f.directory, `${guid(1)}.crdownload`), 'partial')
  f.progress(1, 'inProgress', 1, 50 * 1024 * 1024 + 1)
  await vi.waitFor(() =>
    expect(f.manager.messages().map((message) => message.id)).toEqual([guid(2)]),
  )
  await vi.waitFor(async () =>
    expect(await stat(join(f.directory, `${guid(1)}.crdownload`)).catch(() => null)).toBeNull(),
  )
  expect(f.failure).toHaveBeenCalledTimes(2)
})

it('keeps at most ten ready files and evicts the oldest file before admitting another', async () => {
  const f = await fixture()
  for (let n = 1; n <= 11; n++) {
    f.begin(n)
    await f.complete(n)
  }
  expect(f.manager.messages()).toHaveLength(10)
  await expect(f.manager.read(guid(1))).rejects.toMatchObject({ status: 404 })
  await vi.waitFor(async () =>
    expect(await stat(join(f.directory, guid(1))).catch(() => null)).toBeNull(),
  )
  expect(f.report).not.toHaveBeenCalled()
})

it('expires ready files and times out unfinished transfers', async () => {
  const f = await fixture()
  f.begin(1)
  await f.complete(1)
  vi.useFakeTimers()
  // Existing ready timer was created before fake timers; create the timed entries now.
  f.begin(2)
  await vi.advanceTimersByTimeAsync(10 * 60_000)
  expect(f.manager.messages().some((message) => message.id === guid(2))).toBe(false)
  expect(f.failure).toHaveBeenCalledWith(expect.stringContaining('timed out'))
  f.begin(3)
  await writeFile(join(f.directory, guid(3)), 'x')
  f.progress(3, 'completed', 1)
  await vi.waitFor(() =>
    expect(f.manager.messages().find((message) => message.id === guid(3))?.status).toBe('ready'),
  )
  await vi.advanceTimersByTimeAsync(15 * 60_000)
  await expect(f.manager.read(guid(3))).rejects.toMatchObject({ status: 404 })
})

it('isolates grants by manager and rejects unfinished, changed, removed and closed files', async () => {
  const a = await fixture()
  const b = await fixture()
  a.begin(1, '../\\evil\r\n.csv')
  await expect(a.manager.read(guid(1))).rejects.toMatchObject({ status: 409 })
  await a.complete(1)
  const file = await a.manager.read(guid(1))
  expect(file.name).toBe('evil__.csv')
  expect((await file.handle.stat()).mode & 0o777).toBe(0o600)
  await file.handle.close()
  await expect(b.manager.read(guid(1))).rejects.toMatchObject({ status: 404 })
  await writeFile(join(a.directory, guid(1)), 'tampered-size')
  await expect(a.manager.read(guid(1))).rejects.toMatchObject({ status: 409 })
  await a.manager.remove(guid(1))
  await expect(a.manager.read(guid(1))).rejects.toMatchObject({ status: 404 })
  await a.manager.release()
  expect(a.events.listenerCount('Browser.downloadWillBegin')).toBe(0)
})

it('enforces the aggregate retained byte limit using reported in-flight sizes', async () => {
  const f = await fixture()
  for (let n = 1; n <= 2; n++) {
    f.begin(n)
    const handle = await open(join(f.directory, guid(n)), 'w')
    await handle.truncate(50 * 1024 * 1024)
    await handle.close()
    f.progress(n, 'completed', 50 * 1024 * 1024)
    await vi.waitFor(() =>
      expect(f.manager.messages().find((message) => message.id === guid(n))?.status).toBe('ready'),
    )
  }
  f.begin(3)
  f.progress(3, 'inProgress', 1)
  await vi.waitFor(() => expect(f.manager.messages()).toHaveLength(2))
  expect(f.send).toHaveBeenCalledWith(
    'Browser.cancelDownload',
    expect.objectContaining({ guid: guid(3) }),
  )
})

it('cleans staged files even when Chromium rejects cancellation', async () => {
  const f = await fixture()
  f.begin(1)
  const path = join(f.directory, `${guid(1)}.crdownload`)
  await writeFile(path, 'partial')
  f.send.mockRejectedValueOnce(new Error('Target closed'))
  // A rejected cancel may propagate, but must not bypass filesystem cleanup.
  await Promise.allSettled([f.manager.remove(guid(1))])
  await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('cleans files written by a late completion after explicit cancellation', async () => {
  const f = await fixture()
  f.begin(1)
  await f.manager.remove(guid(1))
  await writeFile(join(f.directory, guid(1)), 'late completion')
  f.progress(1, 'completed', 15)
  await vi.waitFor(async () =>
    expect(await stat(join(f.directory, guid(1))).catch(() => null)).toBeNull(),
  )
  expect(f.manager.messages()).toEqual([])
})

it('removes invalid completed files and reports a visible failure immediately', async () => {
  const f = await fixture()
  f.begin(1)
  await writeFile(join(f.directory, guid(1)), 'actual contents')
  f.progress(1, 'completed', 1)
  await vi.waitFor(() => expect(f.manager.messages()).toEqual([]))
  expect(f.failure).toHaveBeenCalled()
  await expect(stat(join(f.directory, guid(1)))).rejects.toMatchObject({ code: 'ENOENT' })
})

it.each(['goto', 'goBack', 'goForward', 'reload'])(
  'recognizes page.%s download navigation before CDP delivers the begin event',
  async (method) => {
    const f = await fixture()
    const error = new Error(
      `page.${method}: Download is starting\nCall log:\n  - navigating to "http://lan/report"`,
    )
    expect(f.manager.isNavigationDownload(error, Date.now())).toBe(true)
    expect(f.manager.messages()).toEqual([])
  },
)

it.each([
  'Download is starting',
  'page.click: Download is starting',
  'page.goto: Download is starting unexpectedly',
  'page.goto: Timeout 30000ms exceeded\nCall log:\n  - navigating to "http://lan/Download is starting"',
  'page.goto: net::ERR_NAME_NOT_RESOLVED at http://lan/Download is starting',
  'page.goto: net::ERR_ABORTED at http://lan/report',
])('does not classify an unrelated navigation error as a download: %s', async (message) => {
  const f = await fixture()
  expect(f.manager.isNavigationDownload(new Error(message), Date.now())).toBe(false)
})

it('requires a download event from this manager during the current navigation for ERR_ABORTED', async () => {
  const a = await fixture()
  const b = await fixture()
  vi.useFakeTimers()
  const error = new Error('page.goto: net::ERR_ABORTED at http://lan/report')
  const started = Date.now()
  a.begin(1)
  expect(a.manager.isNavigationDownload(error, started)).toBe(true)
  expect(b.manager.isNavigationDownload(error, started)).toBe(false)
  expect(a.manager.isNavigationDownload('page.goto: Download is starting', started)).toBe(false)
  expect(
    a.manager.isNavigationDownload({ message: 'page.goto: Download is starting' }, started),
  ).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  expect(a.manager.isNavigationDownload(error, Date.now())).toBe(false)
  expect(
    a.manager.isNavigationDownload(new Error('page.goto: net::ERR_CONNECTION_REFUSED'), started),
  ).toBe(false)
})

it('does not mistake ERR_ABORTED text in a URL for the actual navigation failure', async () => {
  const f = await fixture()
  const started = Date.now()
  f.begin(1)
  const error = new Error(
    'page.goto: net::ERR_NAME_NOT_RESOLVED at http://missing.invalid/net::ERR_ABORTED',
  )
  expect(f.manager.isNavigationDownload(error, started)).toBe(false)
})

it('refuses to read a ready file replaced with a symlink', async () => {
  const f = await fixture()
  f.begin(1)
  await f.complete(1, 'report')
  const target = join(f.directory, 'outside-download')
  await writeFile(target, 'secret')
  await rm(join(f.directory, guid(1)))
  await symlink(target, join(f.directory, guid(1)))
  await expect(f.manager.read(guid(1))).rejects.toMatchObject({ code: 'ELOOP' })
  await f.manager.remove(guid(1))
  expect(await readFile(target, 'utf8')).toBe('secret')
})

it('rejects a completed symlink without changing its target permissions', async () => {
  const f = await fixture()
  const target = join(f.directory, 'outside-download')
  await writeFile(target, 'secret')
  await chmod(target, 0o640)
  f.begin(1)
  await symlink(target, join(f.directory, guid(1)))
  f.progress(1, 'completed', 6)
  await vi.waitFor(() => expect(f.failure).toHaveBeenCalled())
  expect(f.manager.messages()).toEqual([])
  await expect(stat(join(f.directory, guid(1)))).rejects.toMatchObject({ code: 'ENOENT' })
  expect((await stat(target)).mode & 0o777).toBe(0o640)
  expect(await readFile(target, 'utf8')).toBe('secret')
})

it('invalidates an open file grant when its download is removed or its manager is closed', async () => {
  const f = await fixture()
  f.begin(1)
  await f.complete(1)
  const removed = await f.manager.read(guid(1))
  try {
    expect(removed.current()).toBe(true)
    await f.manager.remove(guid(1))
    expect(removed.current()).toBe(false)
  } finally {
    await removed.handle.close()
  }
  f.begin(2)
  await f.complete(2)
  const closed = await f.manager.read(guid(2))
  try {
    expect(closed.current()).toBe(true)
    await f.manager.release()
    expect(closed.current()).toBe(false)
  } finally {
    await closed.handle.close()
  }
})
