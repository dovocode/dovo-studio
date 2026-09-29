import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { canUpdateServer, serverUpdateStatus } from './server-updates.js'

let directory: string
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'dovo-server-updates-'))
})
afterEach(() => {
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
