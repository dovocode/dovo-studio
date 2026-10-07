import { afterEach, expect, it } from 'vite-plus/test'
import { existsSync, readFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  desktopProfile,
  restoreElectronProfile,
  migrateDesktopDataDirectory,
  selectDesktopDataDirectory,
} from './data-directory'

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

it('moves an existing profile under ~/.dovo after stopping its runtime', () => {
  const { legacy } = profiles()
  const target = join(legacy, '..', '..', '.dovo', 'desktop')
  let stopped = false
  expect(
    migrateDesktopDataDirectory(legacy, target, () => {
      stopped = true
    }),
  ).toBe(target)
  expect(stopped).toBe(true)
  expect(desktopProfile(target).configured).toBe(true)
  expect(desktopProfile(legacy).configured).toBe(false)
})

it('preserves the old profile when the runtime cannot be stopped', () => {
  const { legacy } = profiles()
  const target = join(legacy, '..', '..', '.dovo', 'desktop')
  expect(() =>
    migrateDesktopDataDirectory(legacy, target, () => {
      throw new Error('Busy')
    }),
  ).toThrow('Busy')
  expect(desktopProfile(legacy).configured).toBe(true)
  expect(desktopProfile(target).configured).toBe(false)
})

it('does not choose between two populated profiles', () => {
  const { legacy } = profiles()
  const target = join(legacy, '..', '..', '.dovo', 'desktop')
  mkdirSync(target, { recursive: true })
  writeFileSync(join(target, 'runtime.sqlite'), '')
  expect(() => migrateDesktopDataDirectory(legacy, target, () => {})).toThrow(
    'Both desktop data directories contain a workspace',
  )
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

it('uses the stable workspace for a nightly install, including on a fresh machine', () => {
  const { current, legacy } = profiles()
  const nightly = join(current, '..', 'Dovo Studio (Nightly)')
  const select = () =>
    selectDesktopDataDirectory({
      packaged: true,
      explicitDirectory: false,
      current: desktopProfile(nightly),
      shared: desktopProfile(current),
      legacy: desktopProfile(legacy),
    })
  expect(select()).toBe(legacy)
  rmSync(join(legacy, 'runtime-connection.json'))
  expect(select()).toBe(current)
  writeFileSync(join(current, 'runtime.sqlite'), '')
  expect(select()).toBe(current)
})

it('restores Electron storage while keeping connections, history and unknown files in the workspace', () => {
  const { current, legacy } = profiles()
  for (const name of ['Local State', 'runtime.sqlite', 'runtime-connections.enc', 'custom-file'])
    writeFileSync(join(legacy, name), name)
  mkdirSync(join(legacy, 'Partitions'))
  writeFileSync(join(legacy, 'Partitions', 'preview'), 'browser login')
  restoreElectronProfile(legacy, current)
  expect(readFileSync(join(current, 'Local State'), 'utf8')).toBe('Local State')
  expect(readFileSync(join(current, 'Partitions', 'preview'), 'utf8')).toBe('browser login')
  for (const name of ['runtime.sqlite', 'runtime-connections.enc', 'custom-file']) {
    expect(existsSync(join(legacy, name))).toBe(true)
    expect(existsSync(join(current, name))).toBe(false)
  }
  restoreElectronProfile(legacy, current)
})

it('preflights profile conflicts before moving any files', () => {
  const { current, legacy } = profiles()
  writeFileSync(join(legacy, 'Local State'), 'original')
  writeFileSync(join(legacy, 'Preferences'), 'old')
  writeFileSync(join(current, 'Preferences'), 'new')
  expect(() => restoreElectronProfile(legacy, current)).toThrow('preserving both copies')
  expect(readFileSync(join(legacy, 'Local State'), 'utf8')).toBe('original')
  expect(readFileSync(join(current, 'Preferences'), 'utf8')).toBe('new')
})
