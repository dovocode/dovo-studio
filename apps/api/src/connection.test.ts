import { afterEach, expect, it, vi } from 'vite-plus/test'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { rename } from 'node:fs/promises'
import { connectionPaths, publishConnection } from './connection'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rename: vi.fn<typeof actual.rename>(actual.rename) }
})

let directory: string | undefined
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.mocked(rename).mockReset()
  vi.mocked(rename).mockImplementation(async (...args) => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    return actual.rename(...args)
  })
  vi.restoreAllMocks()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

it.each(['malformed', 'replaced', 'missing', 'owned'])(
  'only removes an owned discovery file during %s cleanup',
  async (kind) => {
    directory = mkdtempSync(join(tmpdir(), 'dovo-discovery-'))
    const path = join(directory, 'runtime-connection.json')
    const connection = {
      address: 'http://127.0.0.1:8000',
      token: 'fixture-token-with-at-least-32-characters',
      pid: 123,
    }
    const release = await publishConnection(directory, connection)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    if (kind === 'malformed') writeFileSync(path, '{')
    if (kind === 'replaced') writeFileSync(path, JSON.stringify({ ...connection, pid: 456 }))
    if (kind === 'missing') rmSync(path)
    expect(release).not.toThrow()
    expect(existsSync(path)).toBe(kind === 'malformed' || kind === 'replaced')
    expect(existsSync(path) ? readFileSync(path, 'utf8') : null).toBe(
      kind === 'malformed'
        ? '{'
        : kind === 'replaced'
          ? JSON.stringify({ ...connection, pid: 456 })
          : null,
    )
    expect(warning).toHaveBeenCalledTimes(kind === 'malformed' ? 1 : 0)
  },
)
it('discovers only the selected development root and its desktop workspace', () => {
  directory = mkdtempSync(join(tmpdir(), 'dovo-discovery-'))
  mkdirSync(join(directory, 'desktop'))
  const paths = [
    join(directory, 'runtime-connection.json'),
    join(directory, 'desktop', 'runtime-connection.json'),
  ]
  for (const path of paths) writeFileSync(path, '{}')
  vi.stubEnv('DOVO_DATA_ROOT', directory)
  vi.stubEnv('DOVO_DATABASE_PATH', undefined)
  expect(connectionPaths()).toEqual(paths)
  vi.stubEnv('DOVO_DATABASE_PATH', join(directory, 'custom', 'runtime.sqlite'))
  expect(connectionPaths()).toEqual([join(directory, 'custom', 'runtime-connection.json')])
})

it('atomically replaces discovery after a transient Windows sharing violation', async () => {
  directory = mkdtempSync(join(tmpdir(), 'dovo-discovery-'))
  const path = join(directory, 'runtime-connection.json')
  const previous = { address: 'http://127.0.0.1:8000', token: 'x'.repeat(32), pid: 123 }
  await publishConnection(directory, previous)
  vi.stubGlobal('process', { ...process, platform: 'win32' })
  vi.mocked(rename).mockImplementationOnce(async () => {
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(previous)
    throw Object.assign(new Error('Sharing violation'), { code: 'EPERM' })
  })
  const remove = await publishConnection(directory, { ...previous, pid: 456 })
  expect(JSON.parse(readFileSync(path, 'utf8')).pid).toBe(456)
  remove()
  expect(existsSync(path)).toBe(false)
})
it('preserves discovery and removes staging files on a permanent publish error', async () => {
  directory = mkdtempSync(join(tmpdir(), 'dovo-discovery-'))
  const path = join(directory, 'runtime-connection.json')
  const previous = { address: 'http://127.0.0.1:8000', token: 'x'.repeat(32), pid: 123 }
  await publishConnection(directory, previous)
  vi.mocked(rename).mockRejectedValueOnce(Object.assign(new Error('Disk error'), { code: 'EIO' }))
  await expect(publishConnection(directory, { ...previous, pid: 456 })).rejects.toThrow(
    'Disk error',
  )
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(previous)
  expect(existsSync(`${path}.${process.pid}.tmp`)).toBe(false)
})

it('bounds retries when a Windows sharing violation persists', async () => {
  directory = mkdtempSync(join(tmpdir(), 'dovo-discovery-'))
  const path = join(directory, 'runtime-connection.json')
  const previous = { address: 'http://127.0.0.1:8000', token: 'x'.repeat(32), pid: 123 }
  await publishConnection(directory, previous)
  vi.stubGlobal('process', { ...process, platform: 'win32' })
  vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValue(2001)
  vi.mocked(rename).mockRejectedValueOnce(
    Object.assign(new Error('Sharing violation'), { code: 'EPERM' }),
  )
  await expect(publishConnection(directory, { ...previous, pid: 456 })).rejects.toThrow(
    'Sharing violation',
  )
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(previous)
  expect(existsSync(`${path}.${process.pid}.tmp`)).toBe(false)
})
