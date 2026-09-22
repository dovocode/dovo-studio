import { afterEach, expect, it } from 'vite-plus/test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { desktopProfile, selectDesktopDataDirectory } from './data-directory'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function profiles() {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-desktop-profile-'))
  directories.push(directory)
  const current = join(directory, 'Dovo Studio')
  const legacy = join(directory, '@dovo', 'desktop')
  mkdirSync(current, { recursive: true })
  mkdirSync(legacy, { recursive: true })
  writeFileSync(join(legacy, 'runtime-connection.json'), '{}')
  return {
    current,
    legacy,
    select: (options: { packaged?: boolean; explicitDirectory?: boolean } = {}) =>
      selectDesktopDataDirectory({
        packaged: true,
        explicitDirectory: false,
        ...options,
        current: desktopProfile(current),
        legacy: desktopProfile(legacy),
      }),
  }
}

it('attaches a fresh packaged profile to the established development workspace', () => {
  const { current, legacy, select } = profiles()
  // Chromium may create its own files before there is any Dovo workspace.
  writeFileSync(join(current, 'Preferences'), '{}')
  expect(select()).toBe(legacy)
})

it.each([
  'runtime.sqlite',
  'runtime.sqlite-wal',
  'runtime-connection.json',
  'runtime-listen.json',
  'runtime-connections.enc',
  'runtime-process.lock',
  'server.json',
  'server-release.json',
  'server-process.json',
  'owner-token',
])('keeps an existing packaged profile containing %s', (filename) => {
  const { current, select } = profiles()
  writeFileSync(join(current, filename), '')
  expect(select()).toBe(current)
})

it('respects an explicitly requested fresh profile and leaves development launches alone', () => {
  const { current, select } = profiles()
  expect(select({ explicitDirectory: true })).toBe(current)
  expect(select({ packaged: false })).toBe(current)
})

it('does not adopt an empty legacy directory', () => {
  const { current, legacy, select } = profiles()
  rmSync(join(legacy, 'runtime-connection.json'))
  expect(select()).toBe(current)
})
