import { afterEach, expect, it, vi } from 'vite-plus/test'
import { execFile, spawn } from 'node:child_process'
import {
  existsSync,
  cpSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { setupServer } from './server-config'
import {
  assertLaunchAllowed,
  packagedServiceWarning,
  prepareLaunch,
  recoverServerUpdate,
  settleLaunch,
  verifyPendingLaunch,
} from './server-update-recovery'

vi.setConfig({ testTimeout: 60_000 })
const directories: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

async function fixture({ sameRecord = false } = {}) {
  // Match the immutable paths recorded by packaged activation, including on macOS.
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'dovo-packaged-recovery-')))
  directories.push(directory)
  const socket = createServer()
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve))
  const address = socket.address()
  if (!address || typeof address === 'string') throw new Error('No fixture port')
  await new Promise<void>((resolve) => socket.close(() => resolve()))
  setupServer(directory, { host: '127.0.0.1', port: String(address.port) })
  const databasePath = join(directory, 'runtime.sqlite')
  const database = new DatabaseSync(databasePath)
  database.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE documents (id TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO documents VALUES ('fixture', 'before update')",
  )
  database.close()
  const previous = join(directory, 'old', 'bin', 'dovo')
  const candidate = join(directory, 'new', 'bin', 'dovo')
  for (const launcher of [previous, candidate]) {
    mkdirSync(join(launcher, '..'), { recursive: true })
    writeFileSync(launcher, '')
    const entrypoint = join(launcher, '..', '..', 'libexec', 'server', 'dist', 'index.js')
    mkdirSync(join(entrypoint, '..'), { recursive: true })
    writeFileSync(entrypoint, '')
  }
  const publicLauncher = join(directory, 'public-launcher')
  symlinkSync(previous, publicLauncher)
  const link = join(directory, 'service-launcher')
  symlinkSync(publicLauncher, link)
  const serviceRecord = join(directory, 'server-service.json')
  const previousRecord = JSON.stringify({ launcher: publicLauncher, version: 'previous' }) + '\n'
  const candidateRecord = sameRecord
    ? previousRecord
    : JSON.stringify({ launcher: publicLauncher, version: 'candidate' }) + '\n'
  writeFileSync(serviceRecord, previousRecord)
  return {
    directory,
    databasePath,
    previous,
    candidate,
    publicLauncher,
    link,
    serviceRecord,
    previousRecord,
    candidateRecord,
    record: join(directory, 'server-update-transaction.json'),
  }
}

function value(path: string) {
  const database = new DatabaseSync(path, { readOnly: true })
  try {
    return database.prepare("SELECT value FROM documents WHERE id = 'fixture'").get()?.value
  } finally {
    database.close()
  }
}

async function crash(
  testFixture: Awaited<ReturnType<typeof fixture>>,
  point:
    | 'prepare'
    | 'prepare-before-change'
    | 'verify'
    | 'rollback'
    | 'candidate-link'
    | 'rollback-link',
  expectedVersion?: string,
) {
  const module = pathToFileURL(
    fileURLToPath(new URL('../dist/server-update-recovery.js', import.meta.url)),
  ).href
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
import fs from 'node:fs'
import { unlinkSync, symlinkSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
const f = ${JSON.stringify(testFixture)}
let stops = 0
const kill = () => process.kill(process.pid, 'SIGKILL')
let linkWrites = 0
const rename = fs.renameSync
fs.renameSync = (...args) => {
  if (args[1] === f.link) {
    linkWrites++
    if (linkWrites === 2 && ${JSON.stringify(point)} === 'candidate-link') kill()
    rename(...args)
    if (linkWrites === 3 && ${JSON.stringify(point)} === 'rollback-link') kill()
    return
  }
  return rename(...args)
}
syncBuiltinESMExports()
const { activatePackagedRelease } = await import(${JSON.stringify(module)})
const result = await activatePackagedRelease(f.directory, {
  previous: f.publicLauncher, replacement: f.publicLauncher, candidateRecord: f.candidateRecord,
  expectedVersion: ${JSON.stringify(expectedVersion)},
  databasePath: f.databasePath, running: true,
  service: {
    stop: async () => { if (++stops === 2 && ${JSON.stringify(point)} === 'rollback') kill() },
    start: async () => {
      const database = new DatabaseSync(f.databasePath)
      database.exec("UPDATE documents SET value = 'written by candidate' WHERE id = 'fixture'")
      database.close()
      if (${JSON.stringify(point)} === 'verify') kill()
    },
  },
  prepare: async () => {
    if (${JSON.stringify(point)} === 'prepare-before-change') kill()
    unlinkSync(f.publicLauncher)
    symlinkSync(f.candidate, f.publicLauncher)
    if (${JSON.stringify(point)} === 'prepare') kill()
  },
  verify: async () => {
    throw new Error('verification failed')
  },
})
console.error('Activation unexpectedly returned', result)
process.exit(2)
`,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
  })
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolve({ code, signal }))
    },
  )
  if (result.code !== null || result.signal !== 'SIGKILL')
    throw new Error(`Updater did not die by SIGKILL: ${JSON.stringify(result)} ${stderr}`)
}

it('pins the old launcher before package preparation can replace the public link', async () => {
  const f = await fixture()
  await crash(f, 'prepare')
  expect(realpathSync(f.publicLauncher)).toBe(f.candidate)
  expect(readlinkSync(f.link)).toBe(f.previous)
  expect(JSON.parse(readFileSync(f.record, 'utf8'))).toMatchObject({
    version: 2,
    phase: 'prepared',
    packaged: { previous: f.previous, candidate: null, initial: f.publicLauncher },
  })
  expect(await prepareLaunch(f.directory)).toBe(false)
  expect(readlinkSync(f.link)).toBe(f.previous)
  expect(readFileSync(f.serviceRecord, 'utf8')).toBe(f.previousRecord)
  expect(value(f.databasePath)).toBe('before update')
  expect(existsSync(f.record)).toBe(false)
})

it('keeps the previous launcher pinned if the package manager retargets after prepared recovery', async () => {
  const f = await fixture({ sameRecord: true })
  await crash(f, 'prepare-before-change')
  expect(realpathSync(f.publicLauncher)).toBe(f.previous)
  expect(readlinkSync(f.link)).toBe(f.previous)
  expect(await prepareLaunch(f.directory)).toBe(false)
  expect(existsSync(f.record)).toBe(false)
  expect(readlinkSync(f.link)).toBe(f.previous)
  expect(packagedServiceWarning(f.directory)).toContain('Keep this package installed')
  unlinkSync(f.publicLauncher)
  symlinkSync(f.candidate, f.publicLauncher)
  expect(realpathSync(f.publicLauncher)).toBe(f.candidate)
  expect(realpathSync(f.link)).toBe(f.previous)
  expect(value(f.databasePath)).toBe('before update')
})

it('finishes a boot-time rollback after an interrupted candidate migration fails verification', async () => {
  const f = await fixture()
  await crash(f, 'verify')
  expect(readlinkSync(f.link)).toBe(f.candidate)
  expect(readFileSync(f.serviceRecord, 'utf8')).toBe(f.candidateRecord)
  expect(value(f.databasePath)).toBe('written by candidate')
  expect(await prepareLaunch(f.directory)).toBe(true)
  settleLaunch(f.directory, false)
  expect(JSON.parse(readFileSync(f.record, 'utf8')).phase).toBe('rolling-back')
  expect(await prepareLaunch(f.directory)).toBe(false)
  expect(readlinkSync(f.link)).toBe(f.previous)
  expect(readFileSync(f.serviceRecord, 'utf8')).toBe(f.previousRecord)
  expect(value(f.databasePath)).toBe('before update')
  expect(existsSync(f.record)).toBe(false)
})

it('admits only the candidate package entrypoint and pinned launcher during verification', async () => {
  const f = await fixture()
  await crash(f, 'verify')
  const previousEntrypoint = join(f.directory, 'old', 'libexec', 'server', 'dist', 'index.js')
  const candidateEntrypoint = join(f.directory, 'new', 'libexec', 'server', 'dist', 'index.js')
  vi.stubEnv('DOVO_SERVER_LAUNCHER', f.publicLauncher)
  expect(() => assertLaunchAllowed(f.directory, previousEntrypoint)).toThrow('Only the release')
  expect(() => assertLaunchAllowed(f.directory, candidateEntrypoint)).not.toThrow()
  vi.stubEnv('DOVO_SERVER_LAUNCHER', f.previous)
  expect(() => assertLaunchAllowed(f.directory, candidateEntrypoint)).toThrow('Only the release')
  vi.stubEnv('DOVO_SERVER_LAUNCHER', f.candidate)
  expect(() => assertLaunchAllowed(f.directory, candidateEntrypoint)).not.toThrow()
})

it('abandons a torn candidate selection when both service records are identical', async () => {
  const f = await fixture({ sameRecord: true })
  await crash(f, 'candidate-link')
  expect(JSON.parse(readFileSync(f.record, 'utf8'))).toMatchObject({
    version: 2,
    phase: 'activating',
    selection: { previous: f.previousRecord, candidate: f.previousRecord },
    packaged: { previous: f.previous, candidate: f.candidate },
  })
  expect(readlinkSync(f.link)).toBe(f.previous)
  expect(readFileSync(f.serviceRecord, 'utf8')).toBe(f.previousRecord)
  expect(await prepareLaunch(f.directory)).toBe(false)
  expect(value(f.databasePath)).toBe('before update')
  expect(readlinkSync(f.link)).toBe(f.previous)
  expect(existsSync(f.record)).toBe(false)
})

it('fails closed if a packaged journal is marked as the legacy source version', async () => {
  const f = await fixture()
  await crash(f, 'verify')
  const transaction = JSON.parse(readFileSync(f.record, 'utf8'))
  expect(transaction.version).toBe(2)
  writeFileSync(f.record, JSON.stringify({ ...transaction, version: 1 }))
  await expect(prepareLaunch(f.directory)).rejects.toThrow('Invalid server update record')
  expect(readlinkSync(f.link)).toBe(f.candidate)
  expect(value(f.databasePath)).toBe('written by candidate')
  expect(existsSync(f.record)).toBe(true)
})

it('finishes a rollback cut after reselection when both service records are identical', async () => {
  const f = await fixture({ sameRecord: true })
  await crash(f, 'rollback-link')
  expect(JSON.parse(readFileSync(f.record, 'utf8'))).toMatchObject({
    phase: 'rolling-back',
    selection: { previous: f.previousRecord, candidate: f.previousRecord },
  })
  expect(readlinkSync(f.link)).toBe(f.previous)
  expect(value(f.databasePath)).toBe('before update')
  expect(await prepareLaunch(f.directory)).toBe(false)
  expect(readlinkSync(f.link)).toBe(f.previous)
  expect(readFileSync(f.serviceRecord, 'utf8')).toBe(f.previousRecord)
  expect(value(f.databasePath)).toBe('before update')
  expect(existsSync(f.record)).toBe(false)
})

it('resumes a rollback killed after its decision but before stopping the candidate', async () => {
  const f = await fixture()
  await crash(f, 'rollback')
  expect(JSON.parse(readFileSync(f.record, 'utf8')).phase).toBe('rolling-back')
  expect(readlinkSync(f.link)).toBe(f.candidate)
  expect(value(f.databasePath)).toBe('written by candidate')
  let stops = 0
  const result = await recoverServerUpdate(f.directory, {
    stop: async () => {
      stops++
    },
    start: async () => {
      throw new Error('must not start candidate')
    },
  })
  expect(result).toMatchObject({ outcome: 'rolled-back' })
  expect(result?.warnings.join(' ')).toContain('package-manager')
  expect(packagedServiceWarning(f.directory)).toContain('package-manager')
  expect(stops).toBe(1)
  expect(readlinkSync(f.link)).toBe(f.previous)
  expect(readFileSync(f.serviceRecord, 'utf8')).toBe(f.previousRecord)
  expect(value(f.databasePath)).toBe('before update')
  if (
    !result ||
    result.outcome !== 'rolled-back' ||
    !('preserved' in result) ||
    typeof result.preserved !== 'string'
  )
    throw new Error('Expected preserved candidate database')
  expect(value(result.preserved)).toBe('written by candidate')
  expect(existsSync(f.record)).toBe(false)
})

it('restores the previous public alias after rollback only when it still selects the old package', async () => {
  const f = await fixture({ sameRecord: true })
  await crash(f, 'rollback')
  unlinkSync(f.publicLauncher)
  symlinkSync(f.previous, f.publicLauncher)
  const result = await recoverServerUpdate(f.directory, {
    stop: async () => {},
    start: async () => {
      throw new Error('must not start candidate')
    },
  })
  expect(result).toMatchObject({ outcome: 'rolled-back', warnings: [] })
  expect(readlinkSync(f.link)).toBe(f.publicLauncher)
  expect(realpathSync(f.link)).toBe(f.previous)
  expect(packagedServiceWarning(f.directory)).toBeUndefined()
  expect(value(f.databasePath)).toBe('before update')
})

it('rejects a mismatched authenticated release during boot and interrupted-update recovery', async () => {
  const f = await fixture({ sameRecord: true })
  await crash(f, 'verify', '2.0.0')
  expect(JSON.parse(readFileSync(f.record, 'utf8')).expectedVersion).toBe('2.0.0')
  const token = 'fixture-owner-token-'.padEnd(32, 'x')
  writeFileSync(
    join(f.directory, 'runtime-connection.json'),
    JSON.stringify({
      address: 'http://127.0.0.1:12345',
      token,
      pid: process.pid,
    }),
  )
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(JSON.stringify({ owner: true, releaseVersion: '1.0.0' }), { status: 200 }),
  )
  vi.stubGlobal('fetch', fetch)
  expect(await prepareLaunch(f.directory)).toBe(true)
  await expect(verifyPendingLaunch(f.directory)).rejects.toThrow('expected release 2.0.0')
  let stops = 0
  const result = await recoverServerUpdate(f.directory, {
    stop: async () => {
      stops++
    },
    start: async () => {
      throw new Error('must not restart the mismatched candidate')
    },
  })
  expect(result).toMatchObject({
    outcome: 'rolled-back',
    error: expect.stringContaining('expected release 2.0.0'),
  })
  expect(stops).toBe(1)
  expect(fetch).toHaveBeenCalledWith(
    'http://127.0.0.1:12345/api/snapshot?scope=overview',
    expect.objectContaining({
      headers: { Authorization: `Bearer ${token}` },
    }),
  )
  expect(readlinkSync(f.link)).toBe(f.previous)
  expect(value(f.databasePath)).toBe('before update')
  expect(existsSync(f.record)).toBe(false)
})

function packageRoots(f: Awaited<ReturnType<typeof fixture>>, candidateScript: string) {
  const dist = fileURLToPath(new URL('../dist', import.meta.url))
  const modules = fileURLToPath(new URL('../node_modules', import.meta.url))
  for (const [name, launcher] of [
    ['old', f.previous],
    ['new', f.candidate],
  ] as const) {
    const root = join(f.directory, name, 'libexec', 'server')
    cpSync(dist, join(root, 'dist'), { recursive: true })
    writeFileSync(join(root, 'package.json'), '{"type":"module"}')
    symlinkSync(modules, join(root, 'node_modules'))
    writeFileSync(
      launcher,
      `#!/bin/sh\nexport DOVO_SERVER_DISTRIBUTION=archive\nexport DOVO_SERVER_LAUNCHER=${JSON.stringify(launcher)}\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(root, 'dist', 'server-cli.js'))} "$@"\n`,
      { mode: 0o755 },
    )
    chmodSync(launcher, 0o755)
    writeFileSync(
      join(root, 'dist', 'index.js'),
      name === 'new'
        ? candidateScript
        : `
import { DatabaseSync } from 'node:sqlite'
import { writeFileSync } from 'node:fs'
const database = new DatabaseSync(process.env.DOVO_DATABASE_PATH, { readOnly: true })
writeFileSync(${JSON.stringify(join(f.directory, 'old-started'))}, database.prepare("SELECT value FROM documents WHERE id = 'fixture'").get().value)
database.close()
`,
    )
  }
}

const runLauncher = promisify(execFile)

it('commits a healthy candidate through the packaged service launcher', async () => {
  const f = await fixture({ sameRecord: true })
  packageRoots(
    f,
    `
import { createServer } from 'node:http'
import { existsSync, writeFileSync } from 'node:fs'
const token = 'fixture-owner-token-'.padEnd(32, 'x')
const server = createServer((request, response) => {
  response.writeHead(request.headers.authorization === 'Bearer ' + token ? 200 : 401, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ owner: true, releaseVersion: '2.0.0' }))
})
server.listen(0, '127.0.0.1', () => {
  writeFileSync(${JSON.stringify(join(f.directory, 'runtime-connection.json'))}, JSON.stringify({ address: 'http://127.0.0.1:' + server.address().port, token, pid: process.pid }))
})
setInterval(() => { if (!existsSync(${JSON.stringify(f.record)})) process.exit(0) }, 25)
`,
  )
  await crash(f, 'verify', '2.0.0')
  await runLauncher(f.candidate, ['service', 'run', '--data-dir', f.directory], { timeout: 15_000 })
  expect(existsSync(f.record)).toBe(false)
  expect(readlinkSync(f.link)).toBe(f.publicLauncher)
  expect(realpathSync(f.link)).toBe(f.candidate)
  expect(value(f.databasePath)).toBe('written by candidate')
})

it('redirects the next packaged boot to the old launcher after candidate failure', async () => {
  const f = await fixture({ sameRecord: true })
  packageRoots(
    f,
    `
import { DatabaseSync } from 'node:sqlite'
const database = new DatabaseSync(process.env.DOVO_DATABASE_PATH)
database.exec("UPDATE documents SET value = 'failed boot migration' WHERE id = 'fixture'")
database.close()
process.exit(1)
`,
  )
  await crash(f, 'verify')
  await expect(
    runLauncher(f.candidate, ['service', 'run', '--data-dir', f.directory], { timeout: 15_000 }),
  ).rejects.toThrow(/Command failed/)
  expect(JSON.parse(readFileSync(f.record, 'utf8')).phase).toBe('rolling-back')
  expect(value(f.databasePath)).toBe('failed boot migration')
  await runLauncher(f.candidate, ['service', 'run', '--data-dir', f.directory], { timeout: 15_000 })
  expect(readFileSync(join(f.directory, 'old-started'), 'utf8')).toBe('before update')
  expect(readlinkSync(f.link)).toBe(f.previous)
  expect(existsSync(f.record)).toBe(false)
})
