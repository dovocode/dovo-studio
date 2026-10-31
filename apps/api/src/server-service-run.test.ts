import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  symlinkSync,
  readlinkSync,
} from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { ChildProcess, spawn } from 'node:child_process'
import { runService } from './server-service'
import { CHILD_OOM_SCORE_ENV, releaseChildOomProtection } from './server-service-protection'

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: vi.fn<typeof spawn>(),
}))
// The real release loop writes to /proc; these tests only check when the supervisor starts it.
vi.mock('./server-service-protection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./server-service-protection')>()),
  releaseChildOomProtection: vi.fn<() => () => void>(() => stopReleasing),
}))
const stopReleasing = vi.hoisted(() => vi.fn<() => void>())

let directory: string | undefined
const previousExitCode = process.exitCode
afterEach(() => {
  process.exitCode = previousExitCode
  vi.resetAllMocks()
  vi.unstubAllEnvs()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

it('loads saved CA and credentials before starting Node and preserves configured bind settings', async () => {
  directory = mkdtempSync(join(tmpdir(), 'dovo-service-env-'))
  writeFileSync(
    join(directory, 'server.json'),
    JSON.stringify({
      version: 1,
      host: '127.0.0.1',
      port: 8000,
      databasePath: join(directory, 'runtime.sqlite'),
    }),
  )
  writeFileSync(
    join(directory, 'runtime-environment.json'),
    JSON.stringify({
      NODE_EXTRA_CA_CERTS: '/fixture/private-ca.pem',
      OPENAI_API_KEY: 'saved-fixture-key',
    }),
  )
  vi.stubEnv('NODE_EXTRA_CA_CERTS', '/old.pem')
  const child = new ChildProcess()
  vi.mocked(spawn).mockImplementation(() => {
    queueMicrotask(() => child.emit('exit', 0))
    return child
  })
  const listeners = process.listenerCount('SIGTERM')
  await runService(directory)
  expect(spawn).toHaveBeenCalledWith(
    process.execPath,
    expect.any(Array),
    expect.objectContaining({
      env: expect.objectContaining({
        NODE_EXTRA_CA_CERTS: '/fixture/private-ca.pem',
        OPENAI_API_KEY: 'saved-fixture-key',
        DOVO_HOST: '127.0.0.1',
        PORT: '8000',
        DOVO_DATABASE_PATH: join(directory, 'runtime.sqlite'),
      }),
    }),
  )
  expect(process.listenerCount('SIGTERM')).toBe(listeners)
})

it('rejects unsupported environment entries before spawning a runtime', async () => {
  directory = mkdtempSync(join(tmpdir(), 'dovo-service-env-'))
  writeFileSync(
    join(directory, 'server.json'),
    JSON.stringify({
      version: 1,
      host: '127.0.0.1',
      port: 8000,
      databasePath: join(directory, 'runtime.sqlite'),
    }),
  )
  writeFileSync(
    join(directory, 'runtime-environment.json'),
    JSON.stringify({ NODE_OPTIONS: '--inspect' }),
  )
  await expect(runService(directory)).rejects.toThrow('Unsupported runtime environment setting')
  expect(spawn).not.toHaveBeenCalled()
})

it('restores the previous release and database before a boot launch after a decided rollback', async () => {
  directory = mkdtempSync(join(tmpdir(), 'dovo-service-boot-'))
  const databasePath = join(directory, 'runtime.sqlite')
  writeFileSync(
    join(directory, 'server.json'),
    JSON.stringify({ version: 1, host: '127.0.0.1', port: 8000, databasePath }),
  )
  const previous = join(directory, 'previous.js')
  const candidate = join(directory, 'candidate.js')
  writeFileSync(previous, '')
  writeFileSync(candidate, '')
  const previousSelection = JSON.stringify({ entrypoint: previous })
  const candidateSelection = JSON.stringify({ entrypoint: candidate })
  mkdirSync(join(directory, 'backups'))
  const backup = join(directory, 'backups', 'runtime-before-boot.sqlite')
  const db = new DatabaseSync(databasePath)
  db.exec(
    "CREATE TABLE documents (id TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO documents VALUES ('fixture', 'before update')",
  )
  db.exec(`VACUUM INTO '${backup}'`)
  db.exec("UPDATE documents SET value = 'written by candidate'")
  db.close()
  writeFileSync(join(directory, 'server-release.json'), candidateSelection)
  writeFileSync(
    join(directory, 'server-update-transaction.json'),
    JSON.stringify({
      version: 1,
      id: 'boot',
      phase: 'rolling-back',
      mode: 'service',
      entrypoint: candidate,
      selection: { previous: previousSelection, candidate: candidateSelection },
      database: { path: databasePath, backup },
      candidates: [],
    }),
  )
  const child = new ChildProcess()
  vi.mocked(spawn).mockImplementation(() => {
    queueMicrotask(() => child.emit('exit', 0))
    return child
  })
  await runService(directory)
  expect(spawn).toHaveBeenCalledWith(process.execPath, [previous], expect.any(Object))
  expect(readFileSync(join(directory, 'server-release.json'), 'utf8')).toBe(previousSelection)
  expect(existsSync(join(directory, 'server-update-transaction.json'))).toBe(false)
  const restored = new DatabaseSync(databasePath, { readOnly: true })
  try {
    expect(restored.prepare('SELECT value FROM documents').get()).toEqual({
      value: 'before update',
    })
  } finally {
    restored.close()
  }
})

it('delegates a packaged boot rollback to the restored launcher instead of starting the candidate runtime', async () => {
  directory = mkdtempSync(join(tmpdir(), 'dovo-package-boot-'))
  const databasePath = join(directory, 'runtime.sqlite')
  writeFileSync(
    join(directory, 'server.json'),
    JSON.stringify({ version: 1, host: '127.0.0.1', port: 8000, databasePath }),
  )
  const launcher = (name: string) => {
    if (!directory) throw new Error('Missing service fixture')
    const root = join(directory, name)
    mkdirSync(join(root, 'bin'), { recursive: true })
    mkdirSync(join(root, 'libexec/server/dist'), { recursive: true })
    writeFileSync(join(root, 'libexec/server/dist/index.js'), '')
    const path = join(root, 'bin/dovo-server')
    writeFileSync(path, '')
    return path
  }
  const previous = launcher('previous')
  const candidate = launcher('candidate')
  const previousRecord = JSON.stringify({ launcher: previous })
  const candidateRecord = JSON.stringify({ launcher: candidate })
  symlinkSync(candidate, join(directory, 'service-launcher'))
  writeFileSync(join(directory, 'server-service.json'), candidateRecord)
  const db = new DatabaseSync(databasePath)
  db.exec(
    "CREATE TABLE documents (id TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO documents VALUES ('fixture', 'candidate')",
  )
  db.close()
  writeFileSync(
    join(directory, 'server-update-transaction.json'),
    JSON.stringify({
      version: 2,
      id: 'package-boot',
      phase: 'rolling-back',
      mode: 'service',
      entrypoint: '',
      selection: { previous: previousRecord, candidate: candidateRecord },
      database: { path: databasePath, backup: null },
      candidates: [],
      packaged: { previous, candidate, initial: previous },
    }),
  )
  vi.stubEnv('DOVO_SERVER_DISTRIBUTION', 'archive')
  vi.stubEnv('DOVO_SERVER_LAUNCHER', candidate)
  const child = new ChildProcess()
  vi.mocked(spawn).mockImplementation(() => {
    queueMicrotask(() => child.emit('exit', 0))
    return child
  })
  await runService(directory)
  expect(spawn).toHaveBeenCalledWith(
    previous,
    ['service', 'run', '--data-dir', directory],
    expect.objectContaining({
      env: expect.objectContaining({ DOVO_SERVER_LAUNCHER: previous }),
    }),
  )
  expect(readlinkSync(join(directory, 'service-launcher'))).toBe(previous)
  expect(readFileSync(join(directory, 'server-service.json'), 'utf8')).toBe(previousRecord)
  expect(existsSync(databasePath)).toBe(false)
  expect(existsSync(join(directory, 'server-update-transaction.json'))).toBe(false)
})

it('finishes boot verification when the runtime cannot spawn', async () => {
  directory = mkdtempSync(join(tmpdir(), 'dovo-service-spawn-'))
  const databasePath = join(directory, 'runtime.sqlite')
  writeFileSync(
    join(directory, 'server.json'),
    JSON.stringify({ version: 1, host: '127.0.0.1', port: 8000, databasePath }),
  )
  const candidate = join(directory, 'candidate.js')
  writeFileSync(candidate, '')
  const selection = JSON.stringify({ entrypoint: candidate })
  writeFileSync(join(directory, 'server-release.json'), selection)
  writeFileSync(
    join(directory, 'server-update-transaction.json'),
    JSON.stringify({
      version: 1,
      id: 'spawn-error',
      phase: 'activating',
      mode: 'service',
      entrypoint: candidate,
      selection: { previous: null, candidate: selection },
      database: { path: databasePath, backup: null },
      candidates: [],
    }),
  )
  const child = new ChildProcess()
  const failure = new Error('Runtime executable could not spawn')
  vi.mocked(spawn).mockImplementation(() => {
    queueMicrotask(() => child.emit('error', failure))
    return child
  })
  const listeners = process.listenerCount('SIGTERM')
  await expect(runService(directory)).rejects.toBe(failure)
  expect(
    JSON.parse(readFileSync(join(directory, 'server-update-transaction.json'), 'utf8')),
  ).toMatchObject({ phase: 'rolling-back' })
  expect(process.listenerCount('SIGTERM')).toBe(listeners)
})

it('refuses a packaged boot that would take over an interrupted source update', async () => {
  directory = mkdtempSync(join(tmpdir(), 'dovo-package-source-'))
  const databasePath = join(directory, 'runtime.sqlite')
  writeFileSync(
    join(directory, 'server.json'),
    JSON.stringify({ version: 1, host: '127.0.0.1', port: 8000, databasePath }),
  )
  const record = JSON.stringify({
    version: 1,
    id: 'source-update',
    phase: 'prepared',
    mode: 'service',
    entrypoint: '/source/index.js',
    selection: { previous: null, candidate: '{}' },
    database: { path: databasePath, backup: null },
    candidates: [],
  })
  writeFileSync(join(directory, 'server-update-transaction.json'), record)
  vi.stubEnv('DOVO_SERVER_DISTRIBUTION', 'archive')
  await expect(runService(directory)).rejects.toThrow('interrupted source update')
  expect(spawn).not.toHaveBeenCalled()
  expect(readFileSync(join(directory, 'server-update-transaction.json'), 'utf8')).toBe(record)
})

it('releases inherited OOM protection only when the opt-in drop-in sets a child score', async () => {
  directory = mkdtempSync(join(tmpdir(), 'dovo-service-oom-'))
  writeFileSync(
    join(directory, 'server.json'),
    JSON.stringify({
      version: 1,
      host: '127.0.0.1',
      port: 8000,
      databasePath: join(directory, 'runtime.sqlite'),
    }),
  )
  const child = new ChildProcess()
  Object.defineProperty(child, 'pid', { value: 4321 })
  vi.mocked(spawn).mockImplementation(() => {
    queueMicrotask(() => child.emit('exit', 0))
    return child
  })
  await runService(directory)
  expect(releaseChildOomProtection).not.toHaveBeenCalled()
  vi.stubEnv(CHILD_OOM_SCORE_ENV, '200')
  await runService(directory)
  expect(releaseChildOomProtection).toHaveBeenCalledWith(200, expect.any(Function))
  expect(vi.mocked(releaseChildOomProtection).mock.calls[0]![1]()).toEqual(
    expect.arrayContaining([process.pid, 4321]),
  )
  expect(stopReleasing).toHaveBeenCalledTimes(1)
  // Agents must not see the supervisor's setting.
  expect(vi.mocked(spawn).mock.calls[1]![2]!.env).toMatchObject({
    [CHILD_OOM_SCORE_ENV]: undefined,
  })
})
