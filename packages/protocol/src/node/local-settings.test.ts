import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  localSettingsPath,
  readLocalSettingsSection,
  writeLocalSettingsSection,
  writeLocalSettingsSections,
} from './local-settings'

const directories: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

it('updates one section without overwriting settings owned by another process', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-settings-'))
  directories.push(directory)
  const path = join(directory, 'settings.json')
  writeLocalSettingsSection('app', () => ({ theme: 'light' }), path)
  writeLocalSettingsSection('runtime', () => ({ branchPrefix: 'dovo/' }), path)
  writeLocalSettingsSection('app', () => ({ theme: 'dark' }), path)
  expect(readLocalSettingsSection('runtime', path)).toEqual({ branchPrefix: 'dovo/' })
  expect(JSON.parse(readFileSync(path, 'utf8')).app).toEqual({ theme: 'dark' })
})

it.skipIf(process.platform === 'win32')('restricts the settings file to its owner', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-settings-'))
  directories.push(directory)
  const path = join(directory, 'settings.json')
  writeLocalSettingsSection('app', () => ({}), path)
  expect(statSync(path).mode & 0o777).toBe(0o600)
})

it('does not replace malformed settings', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-settings-'))
  directories.push(directory)
  const path = join(directory, 'settings.json')
  writeFileSync(path, '{broken')
  expect(() => writeLocalSettingsSection('app', () => ({}), path)).toThrow('Expected property name')
  expect(readFileSync(path, 'utf8')).toBe('{broken')
})

it('honors an isolated settings path for development', () => {
  vi.stubEnv('DOVO_SETTINGS_PATH', '/isolated/.dovo-dev/settings.json')
  expect(localSettingsPath()).toBe('/isolated/.dovo-dev/settings.json')
})

it('replaces several sections in one write and keeps the others', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-settings-'))
  directories.push(directory)
  const path = join(directory, 'settings.json')
  writeLocalSettingsSection('app', () => ({ theme: 'light' }), path)
  writeLocalSettingsSections(
    (document) => ({ runtime: { seen: document.app }, runtimeSaves: { revision: 1 } }),
    path,
  )
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
    app: { theme: 'light' },
    runtime: { seen: { theme: 'light' } },
    runtimeSaves: { revision: 1 },
  })
})

it('writes nothing when the update returns undefined', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-settings-'))
  directories.push(directory)
  const path = join(directory, 'settings.json')
  writeLocalSettingsSection('app', () => ({ theme: 'light' }), path)
  const before = readFileSync(path, 'utf8')
  writeLocalSettingsSections(() => undefined, path)
  expect(readFileSync(path, 'utf8')).toBe(before)
  expect(readdirSync(directory)).toEqual(['settings.json'])
})
