import { afterEach, expect, it } from 'vite-plus/test'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runtimeOwnerToken } from './owner-token.js'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
const fixture = () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-owner-'))
  directories.push(directory)
  return directory
}
it('keeps one owner identity across desktop and background restarts', () => {
  const directory = fixture()
  const first = runtimeOwnerToken(directory)
  expect(first.length).toBeGreaterThanOrEqual(32)
  expect(runtimeOwnerToken(directory)).toBe(first)
  expect(readFileSync(join(directory, 'owner-token'), 'utf8')).toBe(first)
  expect(statSync(join(directory, 'owner-token')).mode & 0o777).toBe(0o600)
})
it('honors explicit credentials without replacing the saved identity and rejects corrupt tokens', () => {
  const directory = fixture()
  const saved = runtimeOwnerToken(directory)
  const explicit = 'explicit-owner-token-at-least-thirty-two-characters'
  expect(runtimeOwnerToken(directory, explicit)).toBe(explicit)
  expect(runtimeOwnerToken(directory)).toBe(saved)
  writeFileSync(join(directory, 'owner-token'), 'invalid')
  expect(() => runtimeOwnerToken(directory)).toThrow('at least 32 characters')
  expect(readFileSync(join(directory, 'owner-token'), 'utf8')).toBe('invalid')
})
