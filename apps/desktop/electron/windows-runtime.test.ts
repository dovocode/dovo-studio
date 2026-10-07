import { afterEach, expect, it, vi } from 'vite-plus/test'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { once } from 'node:events'

const fixture = vi.hoisted(() => ({ directory: '' }))
vi.mock('./runtime-data-directory.js', () => ({ desktopRuntimeDirectory: () => fixture.directory }))
vi.mock('electron', () => ({
  app: { getPath: () => fixture.directory, getVersion: () => '0.0.7' },
}))
const directories: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})
async function directory() {
  const value = await mkdtemp(join(tmpdir(), 'dovo-wsl test '))
  directories.push(value)
  fixture.directory = value
  return value
}
it('parses WSL distribution names, spaces and UTF-16 markers without the default asterisk', async () => {
  const { parseWslDistributions } = await import('./windows-runtime')
  expect(
    parseWslDistributions(
      '\uFEFF  NAME                   STATE           VERSION\r\n* Ubuntu                 Running         2\r\n  Ubuntu Work            Stopped         2\r\n  Legacy                 Stopped         1\r\n'
        .split('')
        .join('\0'),
    ),
  ).toEqual([
    { name: 'Ubuntu', version: 2 },
    { name: 'Ubuntu Work', version: 2 },
    { name: 'Legacy', version: 1 },
  ])
  expect(
    parseWslDistributions('* Ubuntu Work     En cours d’exécution     2\nUbuntu     Arrêté     1', [
      'Ubuntu',
      'Ubuntu Work',
    ]),
  ).toEqual([
    { name: 'Ubuntu Work', version: 2 },
    { name: 'Ubuntu', version: 1 },
  ])
})
it('preserves validated environment choices and supports rollback to an unconfigured state', async () => {
  await directory()
  const { readWindowsRuntimeChoice, writeWindowsRuntimeChoice } = await import('./windows-runtime')
  expect(readWindowsRuntimeChoice()).toBeUndefined()
  writeWindowsRuntimeChoice({ mode: 'wsl', distribution: 'Ubuntu Work' })
  expect(readWindowsRuntimeChoice()).toEqual({ mode: 'wsl', distribution: 'Ubuntu Work' })
  writeWindowsRuntimeChoice({ mode: 'native' })
  expect(readWindowsRuntimeChoice()).toEqual({ mode: 'native' })
  await writeFile(join(fixture.directory, 'windows-runtime.json'), '{"mode":"invalid"}')
  expect(readWindowsRuntimeChoice).toThrow('mode')
  writeWindowsRuntimeChoice(undefined)
  expect(readWindowsRuntimeChoice()).toBeUndefined()
})
it('runs the supervisor with Linux-owned credentials and shuts its runtime down on stdin EOF', async () => {
  const data = await directory()
  const entry = join(data, 'fake-runtime.mjs')
  const stopped = join(data, 'stopped')
  await writeFile(
    entry,
    `
import { writeFileSync } from 'node:fs'; import { dirname, join } from 'node:path';
const directory = dirname(process.env.DOVO_DATABASE_PATH);
writeFileSync(join(directory, 'runtime-connection.json'), JSON.stringify({ address: 'http://127.0.0.1:54321', token: 'linux-owned-token-at-least-thirty-two-characters' }));
writeFileSync(join(directory, 'environment.json'), JSON.stringify(process.env));
process.on('disconnect', () => { writeFileSync(join(directory, 'stopped'), 'graceful'); process.exit(0); });
process.send({ type: 'ready' });
setInterval(() => {}, 1000);
`,
  )
  const { wslSupervisor } = await import('./windows-runtime')
  const child = spawn(process.execPath, ['--input-type=module', '-e', wslSupervisor, entry, data], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DOVO_OWNER_TOKEN: 'windows-token-must-not-be-reused',
      DOVO_SETTINGS_PATH: 'C:\\settings.json',
      DOVO_RUNTIME_ENV_FILE: 'C:\\environment.json',
    },
  })
  const exited = once(child, 'exit')
  try {
    const ready = await new Promise<string>((resolve, reject) => {
      let output = ''
      const timer = setTimeout(() => reject(new Error('Supervisor did not become ready')), 10000)
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString()
        if (output.includes('\n')) {
          clearTimeout(timer)
          resolve(output.trim())
        }
      })
      child.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.once('exit', () => {
        clearTimeout(timer)
        reject(new Error('Supervisor exited before readiness'))
      })
    })
    expect(ready).toContain('DOVO_WSL_READY ')
    expect(ready).toContain('linux-owned-token')
    const environment: unknown = JSON.parse(await readFile(join(data, 'environment.json'), 'utf8'))
    expect(environment).not.toHaveProperty('DOVO_OWNER_TOKEN')
    expect(environment).not.toHaveProperty('DOVO_SETTINGS_PATH')
    expect(environment).not.toHaveProperty('DOVO_RUNTIME_ENV_FILE')
    expect(environment).toHaveProperty('DOVO_DATABASE_PATH', join(data, 'runtime.sqlite'))
    expect(environment).toHaveProperty('DOVO_DESKTOP_DUAL_LISTENER', '1')
    child.stdin.end()
    expect((await exited)[0]).toBe(0)
    expect(await readFile(stopped, 'utf8')).toBe('graceful')
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL')
  }
})

it('accepts only the exact published Linux archive with a valid digest and bounded size', async () => {
  const { selectWslArchive } = await import('./windows-runtime')
  const name = 'Dovo-Server-Nightly-0.0.7-nightly.172-linux-arm64.tar.gz'
  const asset = {
    name,
    size: 123456,
    digest: `sha256:${'a'.repeat(64)}`,
    browser_download_url: `https://github.com/dovocode/dovo-studio/releases/download/v0.0.7-nightly.172/${name}`,
  }
  const release = { draft: false, assets: [asset] }
  expect(selectWslArchive(release, '0.0.7-nightly.172', 'arm64')).toEqual(asset)
  for (const input of [
    { ...release, draft: true },
    { ...release, assets: [{ ...asset, digest: undefined }] },
    { ...release, assets: [{ ...asset, digest: `sha256:${'z'.repeat(64)}` }] },
    { ...release, assets: [{ ...asset, size: 750_000_001 }] },
    { ...release, assets: [{ ...asset, browser_download_url: `https://other.test/${name}` }] },
  ])
    expect(() => selectWslArchive(input, '0.0.7-nightly.172', 'arm64')).toThrow(
      'verified release archive',
    )
  expect(() => selectWslArchive(release, '0.0.7-nightly.172', 'x64')).toThrow(
    'verified release archive',
  )
  expect(() => selectWslArchive(release, '0.0.7', 'arm64')).toThrow('verified release archive')
})
