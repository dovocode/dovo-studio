import { afterEach, expect, it } from 'vite-plus/test'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readLocalSettingsSection, writeLocalSettingsSection } from './local-settings'

const directories: string[] = []
afterEach(() => {
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
