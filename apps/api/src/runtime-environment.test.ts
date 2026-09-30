import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vite-plus/test'
import { persistRuntimeEnvironment, readRuntimeEnvironment } from './runtime-environment'
const directories: string[] = []
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})
function fixture() {
  const path = mkdtempSync(join(tmpdir(), 'dovo-runtime-env-'))
  directories.push(path)
  return path
}
it('persists supported credentials privately and retains them across GUI launches', () => {
  const directory = fixture()
  const path = persistRuntimeEnvironment(directory, {
    ANTHROPIC_API_KEY: 'fixture-credential',
    GH_TOKEN: 'fixture-github',
    HTTPS_PROXY: 'http://proxy:1234',
    UNRELATED_SECRET: 'do-not-copy',
    NODE_OPTIONS: '--import malicious.js',
  })
  expect(readRuntimeEnvironment(path)).toEqual({
    ANTHROPIC_API_KEY: 'fixture-credential',
    GH_TOKEN: 'fixture-github',
    HTTPS_PROXY: 'http://proxy:1234',
  })
  expect(statSync(path).mode & 0o777).toBe(0o600)
  persistRuntimeEnvironment(directory, {})
  expect(readRuntimeEnvironment(path).ANTHROPIC_API_KEY).toBe('fixture-credential')
  expect(readFileSync(path, 'utf8')).not.toContain('do-not-copy')
  persistRuntimeEnvironment(directory, { ANTHROPIC_API_KEY: '' })
  expect(readRuntimeEnvironment(path).ANTHROPIC_API_KEY).toBe('')
})
it('rejects unsupported persisted settings without exposing their values', () => {
  const path = join(fixture(), 'environment.json')
  writeFileSync(path, JSON.stringify({ NODE_OPTIONS: 'fixture-secret-value' }))
  expect(() => readRuntimeEnvironment(path)).toThrow(
    'Unsupported runtime environment setting: NODE_OPTIONS',
  )
})

it('preserves relay connection settings in the managed runtime environment', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-relay-env-'))
  try {
    const path = persistRuntimeEnvironment(directory, {
      DOVO_NOTIFICATION_RELAY_URL: 'http://relay.lan:8080',
      DOVO_NOTIFICATION_RELAY_TOKEN: 'relay-secret-at-least-thirty-two-characters',
    })
    expect(readRuntimeEnvironment(path)).toMatchObject({
      DOVO_NOTIFICATION_RELAY_URL: 'http://relay.lan:8080',
      DOVO_NOTIFICATION_RELAY_TOKEN: 'relay-secret-at-least-thirty-two-characters',
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
