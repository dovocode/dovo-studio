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

it('keeps the saved public address until setup gets an empty one, and keeps pairings', () => {
  const path = directory()
  writeFileSync(join(path, 'runtime.sqlite'), 'existing workspace with pairings')
  const config = setupServer(path, { publicAddress: 'http://192.168.1.10:51464' })
  expect(config.publicAddress).toBe('http://192.168.1.10:51464')
  // Omitting the option keeps the saved address.
  expect(setupServer(path, { port: '51464' }).publicAddress).toBe('http://192.168.1.10:51464')
  // An empty value, as the container passes when DOVO_PUBLIC_ADDRESS is unset, clears it.
  const cleared = setupServer(path, { publicAddress: '' })
  expect(cleared).toEqual({ ...config, publicAddress: undefined })
  expect(readServerConfig(path)).not.toHaveProperty('publicAddress')
  expect(JSON.parse(readFileSync(join(path, 'server.json'), 'utf8'))).not.toHaveProperty(
    'publicAddress',
  )
  expect(setupServer(path, { publicAddress: '  ' })).not.toHaveProperty('publicAddress')
  expect(readFileSync(join(path, 'runtime.sqlite'), 'utf8')).toBe(
    'existing workspace with pairings',
  )
  // It can be set again.
  expect(setupServer(path, { publicAddress: 'http://my-server.tailnet.ts.net:51464' })).toEqual({
    ...config,
    publicAddress: 'http://my-server.tailnet.ts.net:51464',
  })
})
