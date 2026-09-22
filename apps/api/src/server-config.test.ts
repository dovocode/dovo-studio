import { afterEach, expect, it } from 'vite-plus/test'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readServerConfig, setupServer } from './server-config'
import { acquireProcessLock } from './process-lock'

const directories: string[] = []
function directory() {
  const path = mkdtempSync(join(tmpdir(), 'dovo-server-config-'))
  directories.push(path)
  return path
}
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})

it('reuses a desktop workspace listening address and preserves its database and credentials', () => {
  const path = directory()
  writeFileSync(
    join(path, 'runtime-listen.json'),
    JSON.stringify({ address: 'http://127.0.0.1:51464', bindHost: '0.0.0.0' }),
  )
  writeFileSync(join(path, 'runtime.sqlite'), 'existing workspace')
  writeFileSync(join(path, 'owner-token'), 'existing owner credential')
  const config = setupServer(path)
  expect(config).toEqual({
    version: 1,
    host: '0.0.0.0',
    port: 51464,
    databasePath: join(path, 'runtime.sqlite'),
  })
  expect(readServerConfig(path)).toEqual(config)
  expect(readFileSync(join(path, 'runtime.sqlite'), 'utf8')).toBe('existing workspace')
  expect(readFileSync(join(path, 'owner-token'), 'utf8')).toBe('existing owner credential')
  expect(statSync(join(path, 'server.json')).mode & 0o777).toBe(0o600)
})

it('rejects invalid bind, port, public URL and database location before overwriting settings', () => {
  const path = directory()
  const config = setupServer(path, {
    host: 'netbird',
    port: '51464',
    publicAddress: 'https://runtime.example.test',
  })
  for (const options of [
    { port: '0' },
    { port: '65536' },
    { host: 'http://example.test' },
    { publicAddress: 'http://0.0.0.0:51464' },
    { publicAddress: 'https://user:secret@example.test' },
    { database: '/somewhere/else/runtime.sqlite' },
  ])
    expect(() => setupServer(path, options)).toThrow(
      /Invalid server configuration|Host must|Public address must|database must/,
    )
  expect(readServerConfig(path)).toEqual(config)
  expect(setupServer(path, { port: '51465' })).toEqual({ ...config, port: 51465 })
})

it('prevents concurrent operations and releases only the lock it owns', () => {
  const path = join(directory(), 'lock')
  const release = acquireProcessLock(path)
  expect(() => acquireProcessLock(path)).toThrow('Another runtime operation is active')
  writeFileSync(path, JSON.stringify({ pid: process.pid, nonce: 'replacement' }))
  release()
  expect(readFileSync(path, 'utf8')).toContain('replacement')
})
