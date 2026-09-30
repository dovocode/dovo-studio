import { ChildProcess, spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { canUpdateServer, serverUpdateStatus, startServerUpdate } from './server-updates.js'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: vi.fn<typeof spawn>() }
})
const originalArgv = process.argv
let directory: string
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'dovo-server-updates-'))
})
afterEach(() => {
  process.argv = originalArgv
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  rmSync(directory, { recursive: true, force: true })
})

it('offers in-app updates only for a managed archive service', () => {
  vi.stubEnv('DOVO_DATABASE_PATH', join(directory, 'runtime.sqlite'))
  vi.stubEnv('DOVO_SERVER_DISTRIBUTION', 'archive')
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  writeFileSync(
    join(directory, 'server-service.json'),
    JSON.stringify({ launcher: '/opt/homebrew/bin/dovo-server' }),
  )
  expect(canUpdateServer()).toBe(false)
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
  writeFileSync(
    join(directory, 'server-service.json'),
    JSON.stringify({
      launcher: join(homedir(), '.local/share/dovo/server/stable/v1/bin/dovo-server'),
    }),
  )
  expect(canUpdateServer()).toBe(true)
  writeFileSync(
    join(directory, 'server-service.json'),
    JSON.stringify({ launcher: '/opt/mise/installs/dovo-server/bin/dovo-server' }),
  )
  expect(canUpdateServer()).toBe(false)
  vi.stubEnv('DOVO_SERVER_DISTRIBUTION', 'source')
  expect(canUpdateServer()).toBe(false)
})

it('recovers a stalled helper instead of reporting endless progress', () => {
  vi.stubEnv('DOVO_DATABASE_PATH', join(directory, 'runtime.sqlite'))
  writeFileSync(
    join(directory, 'server-update-status.json'),
    JSON.stringify({
      status: 'queued',
      version: '1.0.0',
      updatedAt: new Date(Date.now() - 60_000).toISOString(),
    }),
  )
  expect(serverUpdateStatus()).toMatchObject({ status: 'error', version: '1.0.0' })
})

it('runs the Linux updater outside the server service and reports launch failures', () => {
  vi.stubEnv('DOVO_DATABASE_PATH', join(directory, 'runtime.sqlite'))
  vi.stubEnv('DOVO_SERVER_DISTRIBUTION', 'archive')
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
  writeFileSync(
    join(directory, 'server-service.json'),
    JSON.stringify({
      launcher: join(homedir(), '.local/share/dovo/server/stable/v1/bin/dovo-server'),
    }),
  )
  writeFileSync(join(directory, 'server-cli.js'), '')
  process.argv = [process.execPath, join(directory, 'index.js')]
  const child = new ChildProcess()
  vi.mocked(spawn).mockReturnValue(child)
  expect(startServerUpdate('1.0.1')).toEqual({ status: 'queued', version: '1.0.1' })
  expect(spawn).toHaveBeenCalledWith(
    'systemd-run',
    expect.arrayContaining([
      '--user',
      '--collect',
      '--property=Type=exec',
      process.execPath,
      join(directory, 'server-cli.js'),
      'remote-update',
    ]),
    expect.objectContaining({ stdio: expect.any(Array) }),
  )
  child.emit('exit', 1)
  expect(serverUpdateStatus()).toMatchObject({
    status: 'error',
    version: '1.0.1',
    error: expect.stringContaining('Could not start update service'),
  })
})
