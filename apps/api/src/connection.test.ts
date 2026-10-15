import { afterEach, expect, it, vi } from 'vite-plus/test'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { connectionPaths, publishConnection } from './connection'

let directory: string | undefined
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

it.each(['malformed', 'replaced', 'missing', 'owned'])(
  'only removes an owned discovery file during %s cleanup',
  (kind) => {
    directory = mkdtempSync(join(tmpdir(), 'dovo-discovery-'))
    const path = join(directory, 'runtime-connection.json')
    const connection = {
      address: 'http://127.0.0.1:8000',
      token: 'fixture-token-with-at-least-32-characters',
      pid: 123,
    }
    const release = publishConnection(directory, connection)
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
