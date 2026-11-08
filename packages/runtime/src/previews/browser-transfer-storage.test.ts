import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it } from 'vite-plus/test'
import { BrowserTransferStorage } from './browser-transfer-storage.js'

const directories: string[] = []
const children: ChildProcess[] = []
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill('SIGKILL')
      await exited
    }
  }
  for (const directory of directories.splice(0)) {
    chmodSync(directory, 0o700)
    rmSync(directory, { recursive: true, force: true })
  }
})
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-transfer-storage-'))
  directories.push(directory)
  return directory
}

/** A separate runtime process that stages a file and reports it, then waits to be killed. */
async function stagingRun(root: string) {
  const source = new URL('./browser-transfer-storage.ts', import.meta.url).href
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
      import { writeFileSync } from 'node:fs'
      import { join } from 'node:path'
      import { BrowserTransferStorage } from ${JSON.stringify(source)}
      const directory = await new BrowserTransferStorage(${JSON.stringify(root)}).allocate('upload')
      writeFileSync(join(directory, 'report.csv'), 'a,b\\n', { mode: 0o600 })
      process.send(join(directory, 'report.csv'))
      setInterval(() => {}, 1000)
      `,
    ],
    { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] },
  )
  children.push(child)
  const [path] = (await Promise.race([
    once(child, 'message'),
    once(child, 'exit').then(([code]) => {
      throw new Error(`Staging run exited with ${code}`)
    }),
  ])) as [string]
  return { child, path }
}

it('reclaims a run killed abruptly while preserving live runtimes and unrelated files', async () => {
  const data = fixture()
  const root = join(data, 'browser-transfers')
  const dead = await stagingRun(root)
  const live = await stagingRun(root)
  const current = new BrowserTransferStorage(root)
  const own = await current.allocate('download')
  writeFileSync(join(own, 'partial'), 'x')
  // Durable data beside the root and unrecognized entries inside it are never candidates.
  writeFileSync(join(data, 'draft.txt'), 'keep')
  mkdirSync(join(root, 'run-not-a-uuid'))
  mkdirSync(join(root, 'run-00000000-0000-4000-8000-000000000000'))
  const outside = mkdtempSync(join(tmpdir(), 'dovo-browser-upload-'))
  directories.push(outside)

  const exited = once(dead.child, 'exit')
  dead.child.kill('SIGKILL')
  await exited
  expect(existsSync(dead.path)).toBe(true)

  const restarted = new BrowserTransferStorage(root)
  await expect(restarted.recover()).resolves.toBe(1)
  expect(existsSync(dead.path)).toBe(false)
  expect(existsSync(dirname(dirname(dead.path)) + '.lock')).toBe(false)
  expect(existsSync(live.path)).toBe(true)
  expect(existsSync(join(own, 'partial'))).toBe(true)
  expect(existsSync(join(data, 'draft.txt'))).toBe(true)
  expect(existsSync(join(root, 'run-not-a-uuid'))).toBe(true)
  // A directory without its lock may belong to an owner that has not locked yet.
  expect(existsSync(join(root, 'run-00000000-0000-4000-8000-000000000000'))).toBe(true)
  expect(existsSync(outside)).toBe(true)
  // Recovery runs once per instance.
  await expect(restarted.recover()).resolves.toBe(1)

  // A second sweeper in the live owner's own process cannot reclaim it either.
  await expect(new BrowserTransferStorage(root).recover()).resolves.toBe(0)
  expect(existsSync(own)).toBe(true)

  await current.dispose()
  expect(existsSync(dirname(own))).toBe(false)
  expect(existsSync(dirname(own) + '.lock')).toBe(false)
  await expect(current.allocate('upload')).rejects.toThrow('closed')
})

it('reports failed removals, keeps the lock and retries on the next run', async () => {
  if (process.getuid?.() === 0) return
  const root = join(fixture(), 'browser-transfers')
  const dead = await stagingRun(root)
  const exited = once(dead.child, 'exit')
  dead.child.kill('SIGKILL')
  await exited
  const upload = dirname(dead.path)
  chmodSync(upload, 0o500)
  try {
    await expect(new BrowserTransferStorage(root).recover()).rejects.toThrow(
      'Could not remove stale browser transfers',
    )
    expect(existsSync(dirname(upload) + '.lock')).toBe(true)
  } finally {
    chmodSync(upload, 0o700)
  }
  await expect(new BrowserTransferStorage(root).recover()).resolves.toBe(1)
  expect(readdirSync(root)).toEqual([])
})

it('never follows a run entry that is a symbolic link', async () => {
  const data = fixture()
  const root = join(data, 'browser-transfers')
  const dead = await stagingRun(root)
  const exited = once(dead.child, 'exit')
  dead.child.kill('SIGKILL')
  await exited
  const run = dirname(dirname(dead.path))
  const target = join(data, 'durable')
  mkdirSync(target)
  writeFileSync(join(target, 'keep'), 'keep')
  rmSync(run, { recursive: true })
  symlinkSync(target, run)
  await expect(new BrowserTransferStorage(root).recover()).rejects.toThrow(
    'Unexpected browser transfer entry',
  )
  expect(existsSync(join(target, 'keep'))).toBe(true)
})

it('uses an isolated temporary root for memory runtimes', async () => {
  const first = new BrowserTransferStorage()
  const second = new BrowserTransferStorage()
  const a = await first.allocate('upload')
  const b = await second.allocate('upload')
  expect(dirname(dirname(a))).not.toBe(dirname(dirname(b)))
  await expect(first.recover()).resolves.toBe(0)
  await first.dispose()
  expect(existsSync(dirname(dirname(a)))).toBe(false)
  expect(existsSync(b)).toBe(true)
  await second.dispose()
  expect(existsSync(dirname(dirname(b)))).toBe(false)
})
