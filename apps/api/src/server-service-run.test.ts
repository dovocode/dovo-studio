import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { ChildProcess, spawn } from 'node:child_process'
import { runService } from './server-service'

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: vi.fn<typeof spawn>(),
}))

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
