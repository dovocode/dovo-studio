import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { connectionPaths } from './connection'

let directory: string | undefined
afterEach(() => {
  vi.unstubAllEnvs()
  if (directory) rmSync(directory, { recursive: true, force: true })
})
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
