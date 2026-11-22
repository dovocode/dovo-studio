import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { EventEmitter } from 'node:events'
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unlinkSync } from 'node:fs'
const f = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({ app: { getPath: () => f.root } }))
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>()
  return { ...fs, unlinkSync: vi.fn<typeof fs.unlinkSync>(fs.unlinkSync) }
})
import { clearBrowserHistories, createBrowserHistory } from './browser-history'
beforeEach(async () => {
  f.root = await mkdtemp(join(tmpdir(), 'browser-history-'))
})
afterEach(async () => {
  await rm(f.root, { recursive: true, force: true })
})
it('records real visits and titles, persists per profile and reports visit removal', () => {
  const emit = vi.fn<(...args: unknown[]) => void>()
  const history = createBrowserHistory('work', emit)
  const contents = Object.assign(new EventEmitter(), {
    getTitle: () => 'Website',
    getURL: () => 'https://example.com/',
  })
  history.attach(contents as never)
  contents.emit('did-navigate', {}, 'https://example.com/')
  contents.emit('page-title-updated', {}, 'Updated title')
  expect(history.search({ text: 'updated' })).toMatchObject([
    { visitCount: 1, title: 'Updated title' },
  ])
  expect(history.visits('https://example.com/')).toMatchObject([
    { transition: 'link', isLocal: true },
  ])
  expect(
    createBrowserHistory('personal', vi.fn<(...args: unknown[]) => void>()).search({ text: '' }),
  ).toEqual([])
  expect(
    createBrowserHistory('work', vi.fn<(...args: unknown[]) => void>()).search({ text: '' }),
  ).toHaveLength(1)
  history.remove('https://example.com/')
  expect(emit).toHaveBeenLastCalledWith('history.onVisitRemoved', {
    allHistory: false,
    urls: ['https://example.com/'],
  })
  history.dispose()
  expect(contents.listenerCount('did-navigate')).toBe(0)
})
it('honors search/range bounds and excludes privileged page schemes', () => {
  vi.useFakeTimers()
  try {
    const history = createBrowserHistory('work', vi.fn<(...args: unknown[]) => void>())
    vi.setSystemTime(1000)
    history.add('https://example.com/a', 'First')
    vi.setSystemTime(2000)
    history.add('https://example.com/a', 'First')
    vi.setSystemTime(3000)
    history.add('http://lan.test/b', 'Second')
    expect(history.search({ text: '', startTime: 0, maxResults: 1 })[0]!.title).toBe('Second')
    history.removeRange(1500, 2500)
    expect(history.visits('https://example.com/a')).toHaveLength(1)
    expect(() => history.add('file:///private')).toThrow('web URLs')
    expect(() => history.add('chrome-extension://test/')).toThrow('web URLs')
    history.clear()
    expect(history.search({ text: '', startTime: 0 })).toEqual([])
  } finally {
    vi.useRealTimers()
  }
})

it('keeps valid visits from a damaged store and preserves the original until history is cleared', async () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
  const directory = join(f.root, 'browser-history')
  await mkdir(directory, { recursive: true })
  const valid = {
    id: 'kept',
    url: 'https://example.com/',
    title: 'Kept',
    lastVisitTime: Date.now(),
    visitCount: 1,
    typedCount: 0,
    visits: [],
  }
  const damaged = JSON.stringify([valid, { id: 'broken', url: 7 }])
  await writeFile(join(directory, 'work.json'), damaged)
  await writeFile(join(directory, 'personal.json'), '[{"id": "cut off')
  const history = createBrowserHistory('work', vi.fn<(...args: unknown[]) => void>())
  expect(history.search({ text: '' })).toMatchObject([{ id: 'kept', title: 'Kept' }])
  expect(
    createBrowserHistory('personal', vi.fn<(...args: unknown[]) => void>()).search({ text: '' }),
  ).toEqual([])
  const backups = (await readdir(directory)).filter((name) => name.includes('.damaged-'))
  expect(backups).toHaveLength(2)
  const backup = backups.find((name) => name.startsWith('work.json.damaged-'))!
  expect(await readFile(join(directory, backup), 'utf8')).toBe(damaged)
  // The repaired store loads again without another backup.
  expect(
    createBrowserHistory('work', vi.fn<(...args: unknown[]) => void>()).search({ text: '' }),
  ).toHaveLength(1)
  expect((await readdir(directory)).filter((name) => name.includes('.damaged-'))).toHaveLength(2)
  clearBrowserHistories(new Map([['work', history]]))
  expect((await readdir(directory)).filter((name) => name.includes('.damaged-'))).toEqual([])
  logged.mockRestore()
})
it('leaves an unreadable store untouched', async () => {
  // A folder in place of the file reads as EISDIR, an I/O failure rather than damage.
  await mkdir(join(f.root, 'browser-history', 'work.json'), { recursive: true })
  expect(() => createBrowserHistory('work', vi.fn<(...args: unknown[]) => void>())).toThrow(
    'Browser history could not be read.',
  )
  expect(await readdir(join(f.root, 'browser-history'))).toEqual(['work.json'])
})

it('appends visits without rewriting the snapshot and replays them after a restart', async () => {
  const directory = join(f.root, 'browser-history')
  const history = createBrowserHistory('work', vi.fn<(...args: unknown[]) => void>())
  history.add('https://example.com/a', 'A')
  history.remove('https://example.com/a')
  const snapshot = await stat(join(directory, 'work.json'))
  history.add('https://example.com/b', 'B')
  history.add('https://example.com/b', 'B again', 'typed')
  expect((await stat(join(directory, 'work.json'))).mtimeMs).toBe(snapshot.mtimeMs)
  expect((await readFile(join(directory, 'work.json.journal'), 'utf8')).split('\n')).toHaveLength(3)
  // A crash during an append leaves a partial last line.
  await appendFile(join(directory, 'work.json.journal'), '{"type":"visit","url":')
  const restarted = createBrowserHistory('work', vi.fn<(...args: unknown[]) => void>())
  expect(restarted.search({ text: '', startTime: 0 })).toMatchObject([
    { url: 'https://example.com/b', title: 'B again', visitCount: 2, typedCount: 1 },
  ])
  // Startup folds the journal into the snapshot.
  expect(await readdir(directory)).toEqual(['work.json'])
})

it('keeps removals when the process stops before the journal is deleted', async () => {
  const directory = join(f.root, 'browser-history')
  const history = createBrowserHistory('work', vi.fn<(...args: unknown[]) => void>())
  history.add('https://example.com/kept')
  history.add('https://example.com/removed')
  const journal = await readFile(join(directory, 'work.json.journal'), 'utf8')
  history.remove('https://example.com/removed')
  history.add('https://example.com/later')
  history.removeRange(0, 1)
  // Restore the journal as it was before removal, followed by the removal entry, as if the
  // runtime stopped after writing the snapshot and before deleting the journal.
  await writeFile(
    join(directory, 'work.json.journal'),
    `${journal}${JSON.stringify({ type: 'remove', url: 'https://example.com/removed' })}\n`,
  )
  const restarted = createBrowserHistory('work', vi.fn<(...args: unknown[]) => void>())
  expect(
    restarted
      .search({ text: '', startTime: 0 })
      .map((item) => item.url)
      .toSorted(),
  ).toEqual(['https://example.com/kept', 'https://example.com/later'])
  expect(restarted.visits('https://example.com/kept')).toHaveLength(1)
})

it('keeps a published removal through a journal cleanup failure and a later edit', () => {
  const history = createBrowserHistory('work', vi.fn<(...args: unknown[]) => void>())
  history.add('https://example.com/removed')
  vi.mocked(unlinkSync).mockImplementationOnce(() => {
    throw new Error('Journal is busy')
  })
  expect(() => history.remove('https://example.com/removed')).toThrow('Journal is busy')
  expect(history.search({ text: '', startTime: 0 })).toEqual([])
  history.add('https://example.com/new')
  const reopened = createBrowserHistory('work', vi.fn<(...args: unknown[]) => void>())
  expect(reopened.search({ text: '', startTime: 0 }).map(({ url }) => url)).toEqual([
    'https://example.com/new',
  ])
})

it('compacts a long journal, keeps private profiles in memory and clears every journal', async () => {
  const directory = join(f.root, 'browser-history')
  const history = createBrowserHistory('work', vi.fn<(...args: unknown[]) => void>())
  for (let index = 0; index < 1_000; index++) history.add(`https://example.com/${index}`)
  expect(await readdir(directory)).toEqual(['work.json'])
  history.add('https://example.com/journaled')
  const inactive = createBrowserHistory('personal', vi.fn<(...args: unknown[]) => void>())
  inactive.add('https://example.com/personal')
  expect((await readdir(directory)).toSorted()).toEqual([
    'personal.json.journal',
    'work.json',
    'work.json.journal',
  ])

  const privateHistory = createBrowserHistory(
    'private-00000000-0000-4000-8000-000000000000',
    vi.fn<(...args: unknown[]) => void>(),
  )
  privateHistory.add('https://example.com/private')
  privateHistory.remove('https://example.com/private')
  expect((await readdir(directory)).filter((name) => name.startsWith('private-'))).toEqual([])

  clearBrowserHistories(new Map([['work', history]]))
  expect(await readdir(directory)).toEqual(['work.json'])
  expect(JSON.parse(await readFile(join(directory, 'work.json'), 'utf8'))).toEqual([])
  expect(
    createBrowserHistory('personal', vi.fn<(...args: unknown[]) => void>()).search({ text: '' }),
  ).toEqual([])
})

// Use a regular file for progress and kill at a specific filesystem operation.
const writer = `
import fs from 'node:fs'
import { join } from 'node:path'
import { registerHooks, syncBuiltinESMExports } from 'node:module'
const root = process.env.HISTORY_ROOT
const stopAfter = Number(process.env.HISTORY_STOP_AFTER)
const crashAt = process.env.HISTORY_CRASH_AT
const append = fs.appendFileSync
const rename = fs.renameSync
let finished = 0
const crash = () => process.kill(process.pid, 'SIGKILL')
fs.appendFileSync = (path, text, options) => {
  if (crashAt === 'append' && finished === stopAfter && String(path).endsWith('.journal')) {
    append(path, String(text).slice(0, 12), options)
    crash()
  }
  return append(path, text, options)
}
fs.renameSync = (from, to) => {
  rename(from, to)
  if (crashAt === 'compact' && finished === stopAfter && String(to).endsWith('work.json')) crash()
}
syncBuiltinESMExports()
const report = (operation, url) => {
  append(join(root, 'progress.log'), operation + ' ' + url + '\\n')
  if (++finished > stopAfter) throw new Error('Missed the expected crash point')
}
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'electron')
      return {
        url: 'data:text/javascript,export const app={getPath:()=>process.env.HISTORY_ROOT}',
        shortCircuit: true,
      }
    return next(specifier, context)
  },
})
const { createBrowserHistory } = await import(process.argv[2])
const history = createBrowserHistory('work', () => {})
for (let index = 0; ; index++) {
  const url = 'https://example.com/' + (index % 1500)
  history.add(url)
  report('add', url)
  if (crashAt === 'append' && index % 250 === 249) {
    const removed = 'https://example.com/' + ((index - 100) % 1500)
    history.remove(removed)
    report('remove', removed)
  }
}
`
it.skipIf(process.platform === 'win32')(
  'keeps every finished visit and removal when the process is killed mid-write',
  { timeout: 60_000 },
  async () => {
    const script = join(f.root, 'writer.mts')
    await writeFile(script, writer)
    const fixtureRoot = f.root
    // Cover a torn append, writes after removals, and a new snapshot with its old journal.
    const crashPoints = [
      ['append', 250],
      ['append', 990],
      ['compact', 999],
      ['append', 2400],
    ] as const
    for (const [round, [crashAt, stopAfter]] of crashPoints.entries()) {
      const root = join(fixtureRoot, `round-${round}`)
      await mkdir(root)
      const child = spawn(
        process.execPath,
        [
          '--conditions=development',
          '--import',
          createRequire(import.meta.url).resolve('tsx'),
          script,
          new URL('./browser-history.ts', import.meta.url).href,
        ],
        {
          env: {
            ...process.env,
            HISTORY_ROOT: root,
            HISTORY_STOP_AFTER: String(stopAfter),
            HISTORY_CRASH_AT: String(crashAt),
          },
          stdio: ['ignore', 'ignore', 'pipe'],
        },
      )
      let stderr = ''
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk))
      const signal = await new Promise<string | null>((resolve, reject) => {
        child.once('error', reject)
        child.once('close', (_code, signal) => resolve(signal))
      })
      expect(signal, stderr).toBe('SIGKILL')
      const done = (await readFile(join(root, 'progress.log'), 'utf8')).trimEnd().split('\n')
      expect(done).toHaveLength(stopAfter)

      // Replay the finished operations to find the expected visit count for each page.
      const expected = new Map<string, number>()
      for (const line of done) {
        const [operation, url] = line.split(' ') as ['add' | 'remove', string]
        if (operation === 'add') expected.set(url, (expected.get(url) ?? 0) + 1)
        else expected.delete(url)
      }
      // The compaction case dies after the new snapshot is installed, so the last visit
      // must survive too. The other cases leave only an incomplete journal record.
      if (crashAt === 'compact') expected.set(`https://example.com/${stopAfter}`, 1)
      f.root = root
      try {
        for (const load of ['after the kill', 'after startup compaction']) {
          const history = createBrowserHistory('work', vi.fn<(...args: unknown[]) => void>())
          const saved = new Map(
            history
              .search({ text: '', startTime: 0, maxResults: 10_000 })
              .map((item) => [item.url, item.visitCount]),
          )
          expect(saved, load).toEqual(expected)
          for (const url of saved.keys())
            expect(new Set(history.visits(url).map((visit) => visit.visitId)).size).toBe(
              saved.get(url),
            )
          history.dispose()
        }
      } finally {
        f.root = fixtureRoot
      }
    }
  },
)

it('keeps a visit appended after a journal whose only record was cut off', async () => {
  const directory = join(f.root, 'browser-history')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'work.json.journal'), '{"typ')
  const history = createBrowserHistory('work', vi.fn<(...args: unknown[]) => void>())
  // Startup folds even a journal with no valid entry, so the torn record is gone.
  expect(await readdir(directory)).toEqual(['work.json'])
  history.add('https://example.com/recovered', 'Saved after crash')
  expect(
    createBrowserHistory('work', vi.fn<(...args: unknown[]) => void>()).search({
      text: 'saved after crash',
    }),
  ).toHaveLength(1)
})

it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
  'starts a new line after a torn record while compaction keeps failing',
  async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const directory = join(f.root, 'browser-history')
    await mkdir(directory, { recursive: true })
    const earlier = {
      type: 'visit',
      id: 'earlier',
      url: 'https://example.com/earlier',
      title: 'Earlier',
      transition: 'link',
      visitId: 'earlier-visit',
      time: Date.now(),
    }
    await writeFile(join(directory, 'work.json.journal'), `${JSON.stringify(earlier)}\n{"typ`)
    // The journal stays writable, but the folder refuses the snapshot's temporary file.
    await chmod(directory, 0o500)
    try {
      const first = createBrowserHistory('work', vi.fn<(...args: unknown[]) => void>())
      first.add('https://example.com/first', 'First')
      first.add('https://example.com/second', 'Second')
      const second = createBrowserHistory('work', vi.fn<(...args: unknown[]) => void>())
      second.add('https://example.com/third', 'Third')
      const urls = (history: ReturnType<typeof createBrowserHistory>) =>
        history
          .search({ text: '', startTime: 0 })
          .map((item) => item.url)
          .toSorted()
      const expected = [
        'https://example.com/earlier',
        'https://example.com/first',
        'https://example.com/second',
        'https://example.com/third',
      ]
      expect(urls(createBrowserHistory('work', vi.fn<(...args: unknown[]) => void>()))).toEqual(
        expected,
      )
      expect(logged).toHaveBeenCalledWith('Could not compact browser history.', expect.anything())
      await chmod(directory, 0o700)
      expect(urls(createBrowserHistory('work', vi.fn<(...args: unknown[]) => void>()))).toEqual(
        expected,
      )
      expect(await readdir(directory)).toEqual(['work.json'])
    } finally {
      await chmod(directory, 0o700)
      logged.mockRestore()
    }
  },
)
