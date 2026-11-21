import { afterEach, expect, it, vi } from 'vite-plus/test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TerminalHolder } from './holder-client'
import { HOLDER_STATE_FILE, holderSocketPath } from './holder-protocol'
import { runtimeIntegration, waitForRuntime } from '../testing/integration'

vi.setConfig(runtimeIntegration)
const helper = fileURLToPath(new URL('./holder.ts', import.meta.url))
const children: ChildProcess[] = []
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const child of children.splice(0))
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function folder(name = 'dovo-holder-start-') {
  const directory = await mkdtemp(join(tmpdir(), name))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  return directory
}
function start(directory: string) {
  const child = spawn(process.execPath, [helper, directory], { stdio: 'ignore' })
  children.push(child)
  const exited = once(child, 'exit') as Promise<[number | null, NodeJS.Signals | null]>
  return { child, exited }
}
const statePid = async (directory: string) =>
  (JSON.parse(await readFile(join(directory, HOLDER_STATE_FILE), 'utf8')) as { pid: number }).pid
async function create(directory: string) {
  const holder = new TerminalHolder(directory)
  const terminal = holder.open(randomUUID(), {
    file: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    cwd: tmpdir(),
    env: {},
    cols: 80,
    rows: 24,
  })
  const failures: string[] = []
  terminal.onFailure((error) => failures.push(`${error.kind}: ${error.message}`))
  await waitForRuntime(() => {
    expect(failures).toEqual([])
    expect(terminal.ready).toBe(true)
  })
  return { holder, terminal }
}

async function race(directory: string, count: number) {
  const starts = Array.from({ length: count }, () => start(directory))
  // Every starter but one sees the winner and leaves without touching its socket or key.
  const winner = await waitForRuntime(async () => {
    const pid = await statePid(directory)
    const owner = starts.find(({ child }) => child.pid === pid)?.child
    expect(owner).toBeDefined()
    expect(owner?.exitCode).toBeNull()
    expect(owner?.signalCode).toBeNull()
    for (const { child } of starts) {
      if (child !== owner) {
        expect(child.exitCode).toBe(0)
        expect(child.signalCode).toBeNull()
      }
    }
    return owner!
  })
  return winner
}

it.skipIf(process.platform === 'win32')(
  'lets exactly one of several simultaneous starters own the socket and key',
  async () => {
    const directory = join(await folder(), 'holder')
    const winner = await race(directory, 6)
    const first = await create(directory)
    first.holder.disconnect()

    // A holder that dies leaves a stale socket and state. The next race replaces them once.
    winner.kill('SIGKILL')
    await once(winner, 'exit')
    expect(existsSync(holderSocketPath(directory))).toBe(true)
    const next = await race(directory, 6)
    expect(next.pid).not.toBe(winner.pid)
    const second = await create(directory)
    await second.terminal.close()
    second.holder.disconnect()
  },
)

it.skipIf(process.platform === 'win32')(
  'waits for an active starter and binds when its process dies',
  async () => {
    const directory = join(await folder(), 'holder')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const sqlite = createRequire(import.meta.url).resolve('better-sqlite3')
    const blocker = spawn(
      process.execPath,
      [
        '-e',
        `
      const Database = require(process.argv[1])
      const db = new Database(process.argv[2])
      db.exec('BEGIN IMMEDIATE')
      process.send('locked')
      setInterval(() => {}, 60000)
    `,
        sqlite,
        join(directory, 'holder-startup.sqlite'),
      ],
      {
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      },
    )
    children.push(blocker)
    await once(blocker, 'message', { signal: AbortSignal.timeout(5000) })
    const waiting = start(directory)
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(waiting.child.exitCode).toBeNull()
    expect(existsSync(holderSocketPath(directory))).toBe(false)
    blocker.kill('SIGKILL')
    await waitForRuntime(async () => expect(await statePid(directory)).toBe(waiting.child.pid))
  },
)

it.skipIf(process.platform === 'win32')(
  'removes its temporary socket when the data folder of a long path is removed',
  async () => {
    const base = await folder()
    const directory = join(base, 'a'.repeat(60), 'b'.repeat(60), 'holder')
    const socket = holderSocketPath(directory)
    expect(socket.startsWith(directory)).toBe(false)
    const { holder, terminal } = await create(directory)
    const pid = await statePid(directory)
    holder.disconnect()
    expect(existsSync(socket)).toBe(true)
    await rm(join(base, 'a'.repeat(60)), { recursive: true, force: true })
    await waitForRuntime(() => {
      expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }))
      expect(() => process.kill(terminal.pid, 0)).toThrow(
        expect.objectContaining({ code: 'ESRCH' }),
      )
    })
    expect(existsSync(socket)).toBe(false)
  },
)
