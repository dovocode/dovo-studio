import { afterEach, expect, it, vi } from 'vite-plus/test'
import { existsSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, delimiter } from 'node:path'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import * as children from 'node:child_process'
import * as configuration from './server-config'
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: vi.fn<typeof actual.spawn>(actual.spawn) }
})
import { promisify } from 'node:util'
import { setupServer } from './server-config'
import { serverStatus, startServer, stopServer, processExists } from './server-manager'
import { readConnection } from './connection'

const execute = promisify(execFile)
const directories: string[] = []
const entrypoint = fileURLToPath(new URL('../dist/index.js', import.meta.url))
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-server-lifecycle-'))
  directories.push(directory)
  const socket = createServer()
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve))
  const address = socket.address()
  if (!address || typeof address === 'string') throw new Error('No fixture port')
  await new Promise<void>((resolve) => socket.close(() => resolve()))
  setupServer(directory, { host: '127.0.0.1', port: String(address.port) })
  return directory
}
afterEach(async (context) => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const directory of directories.splice(0)) {
    if (context.task.result?.state === 'fail') {
      const log = join(directory, 'server.log')
      try {
        console.error(`Runtime lifecycle log (${directory}):\n${readFileSync(log, 'utf8')}`)
      } catch (error) {
        console.error('Could not read runtime lifecycle log', error)
      }
    }
    await stopServer(directory)
    // Windows can retain filesystem locks briefly after confirmed process exit.
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

it('starts independently, reuses a healthy runtime, and preserves pairing through restart without printing credentials', async () => {
  vi.stubEnv('DOVO_DESKTOP_DUAL_LISTENER', '1')
  const directory = await fixture()
  const initial = await startServer(directory, entrypoint)
  expect(initial.running).toBe(true)
  expect(initial.managed).toBe(true)
  expect((await startServer(directory, entrypoint)).pid).toBe(initial.pid)
  const connection = readConnection(join(directory, 'runtime-connection.json'))
  expect(JSON.stringify(initial)).not.toContain(connection.token)
  const response = await fetch(connection.address + '/api/pair/code', {
    method: 'POST',
    headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ autoApprove: true }),
  })
  const code = await response.json()
  const pending = await fetch(connection.address + '/api/pair/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ protocolVersion: 2, code: code.code, name: 'Lifecycle phone' }),
  }).then((value) => value.json())
  const paired = await fetch(connection.address + '/api/pair/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: pending.id, secret: pending.secret }),
  }).then((value) => value.json())
  expect(paired.status).toBe('approved')
  const confirmation = await fetch(connection.address + '/api/pair/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pending),
  })
  expect(confirmation.ok).toBe(true)
  await stopServer(directory)
  expect((await serverStatus(directory)).running).toBe(false)
  const next = await startServer(directory, entrypoint)
  expect(next.pid).not.toBe(initial.pid)
  expect(readConnection(join(directory, 'runtime-connection.json')).token).toBe(connection.token)
  const authenticated = await fetch(connection.address + '/api/snapshot', {
    headers: { Authorization: `Bearer ${paired.token}` },
  })
  expect(authenticated.status).toBe(200)
}, 30000)

it('restarts on a changed host and port without losing the owner credential', async () => {
  const directory = await fixture()
  const first = await startServer(directory, entrypoint)
  const token = readConnection(join(directory, 'runtime-connection.json')).token
  await stopServer(directory)
  // Reserve on the actual bind address; a loopback-only free port may be occupied
  // on another interface when the restarted runtime binds all IPv4 interfaces.
  const socket = createServer()
  await new Promise<void>((resolve) => socket.listen(0, '0.0.0.0', resolve))
  const address = socket.address()
  if (!address || typeof address === 'string') throw new Error('No fixture port')
  await new Promise<void>((resolve) => socket.close(() => resolve()))
  setupServer(directory, { host: '0.0.0.0', port: String(address.port) })
  const next = await startServer(directory, entrypoint)
  expect(next.pid).not.toBe(first.pid)
  expect(next.host).toBe('0.0.0.0')
  expect(next.port).toBe(address.port)
  expect(readConnection(join(directory, 'runtime-connection.json')).token).toBe(token)
}, 30000)

it('rejects stopping a runtime owned by another launcher', async () => {
  const directory = await fixture()
  const initial = await startServer(directory, entrypoint)
  const statePath = join(directory, 'server-process.json')
  const original = readFileSync(statePath, 'utf8')
  writeFileSync(
    statePath,
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
  )
  try {
    await expect(stopServer(directory)).rejects.toThrow('Cannot verify managed process')
  } finally {
    writeFileSync(statePath, original)
  }
  expect((await serverStatus(directory)).pid).toBe(initial.pid)
}, 30000)

it('leaves the running server untouched when staged dependency installation fails', async () => {
  const directory = await fixture()
  const initial = await startServer(directory, entrypoint)
  const fakePnpm = join(directory, process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm')
  writeFileSync(
    fakePnpm,
    process.platform === 'win32' ? '@echo off\r\nexit /b 12\r\n' : '#!/bin/sh\nexit 12\n',
    { mode: 0o700 },
  )
  await expect(
    execute(
      process.execPath,
      [
        fileURLToPath(new URL('../dist/server-cli.js', import.meta.url)),
        'update',
        '--data-dir',
        directory,
        '--json',
      ],
      {
        env: { ...process.env, PATH: `${directory}${delimiter}${process.env.PATH}` },
        timeout: 30000,
      },
    ),
  ).rejects.toThrow('pnpm exited with 12')
  expect((await serverStatus(directory)).pid).toBe(initial.pid)
  expect((await serverStatus(directory)).running).toBe(true)
}, 30000)

it('drains the exact spawned candidate when publishing its managed process record fails', async () => {
  const directory = await fixture()
  const launched = vi.spyOn(children, 'spawn')
  const original = configuration.writePrivateJson
  vi.spyOn(configuration, 'writePrivateJson').mockImplementation((path, value) => {
    if (path === join(directory, 'server-process.json')) throw new Error('managed record disk full')
    original(path, value)
  })
  await expect(startServer(directory, entrypoint)).rejects.toThrow('managed record disk full')
  const child = launched.mock.results.find((result) => result.type === 'return')?.value
  expect(child?.pid).toBeTypeOf('number')
  if (!child?.pid) throw new Error('Expected the actual spawned runtime')
  expect(processExists(child.pid)).toBe(false)
  expect((await serverStatus(directory)).running).toBe(false)
}, 30000)

it('continues observing startup when the second authenticated readiness probe fails', async () => {
  const directory = await fixture()
  const request = globalThis.fetch
  let successful = 0,
    interrupted = false
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (...args) => {
    const response = await request(...args)
    if (response.ok && ++successful === 2) {
      interrupted = true
      return new Response('transient readiness failure', { status: 503 })
    }
    return response
  })
  const ready = await startServer(directory, entrypoint)
  expect(interrupted).toBe(true)
  expect(successful).toBeGreaterThan(2)
  expect(ready).toMatchObject({ running: true, managed: true })
}, 30000)

it.skipIf(process.platform === 'win32')(
  'restores the previous release and database when an updated release migrates and fails',
  async () => {
    const directory = await fixture()
    const initial = await startServer(directory, entrypoint)
    const candidate = join(directory, 'candidate.mjs')
    writeFileSync(
      candidate,
      `import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync(process.env.DOVO_DATABASE_PATH)
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE candidate_migration (applied TEXT)')
process.exit(1)`,
    )
    const runtime = fileURLToPath(new URL('../../../packages/runtime', import.meta.url))
    // Installs only what the release smoke check imports, then "builds" the failing release.
    writeFileSync(
      join(directory, 'pnpm'),
      `#!/bin/sh\ncase "$1" in\n  install) mkdir -p apps/api/node_modules/@dovo && ln -s "${runtime}" apps/api/node_modules/@dovo/runtime ;;\n  *) mkdir -p apps/api/dist && cp "${candidate}" apps/api/dist/index.js ;;\nesac\n`,
      { mode: 0o700 },
    )
    const failure = await execute(
      process.execPath,
      [
        fileURLToPath(new URL('../dist/server-cli.js', import.meta.url)),
        'update',
        '--data-dir',
        directory,
        '--json',
      ],
      {
        env: { ...process.env, PATH: `${directory}${delimiter}${process.env.PATH}` },
        timeout: 90000,
      },
    ).catch((error: unknown) => error)
    expect(failure).toMatchObject({
      stderr: expect.stringContaining(
        'the previous release and its database were restored and restarted',
      ),
    })
    const status = await serverStatus(directory)
    expect(status).toMatchObject({ running: true, managed: true })
    expect(status.pid).not.toBe(initial.pid)
    expect(existsSync(join(directory, 'server-release.json'))).toBe(false)
    expect(existsSync(join(directory, 'server-update-transaction.json'))).toBe(false)
    const db = new DatabaseSync(join(directory, 'runtime.sqlite'), { readOnly: true })
    try {
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE name = 'candidate_migration'").get(),
      ).toBeUndefined()
    } finally {
      db.close()
    }
  },
  120000,
)

it('never adopts an already running runtime as an admitted release', async () => {
  const directory = await fixture()
  const running = await startServer(directory, entrypoint)
  const admit = vi.fn<(pid: number) => void>()
  await expect(startServer(directory, entrypoint, admit)).rejects.toThrow(
    `Runtime process ${running.pid} is already running`,
  )
  expect(admit).not.toHaveBeenCalled()
  expect((await serverStatus(directory)).pid).toBe(running.pid)
}, 30000)
