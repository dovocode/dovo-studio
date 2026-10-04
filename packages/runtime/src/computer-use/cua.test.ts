import { decode, commandsSchema } from '@dovo/protocol'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkCua, detectCua, cuaAgentServer } from './cua.js'
import { exec } from '../process.js'

vi.mock('../process.js', () => ({ exec: vi.fn<typeof exec>(), processEnvironment: () => ({}) }))
const home = vi.hoisted(() => ({ path: '' }))
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  homedir: () => home.path,
}))
let directory: string
const binary = () => (process.platform === 'win32' ? 'cua-driver.exe' : 'cua-driver')
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'dovo-cua-'))
  home.path = directory
  vi.stubEnv('LOCALAPPDATA', directory)
  vi.stubEnv('PATH', directory)
  vi.mocked(exec).mockReset()
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(directory, { recursive: true, force: true })
})

it('detects the driver on this runtime PATH and honors a literal path with spaces', async () => {
  const path = join(directory, binary())
  await writeFile(path, '', { mode: 0o755 })
  expect(await detectCua('')).toBe(path)
  const custom = join(directory, `custom driver${process.platform === 'win32' ? '.exe' : ''}`)
  await writeFile(custom, '', { mode: 0o755 })
  expect(await detectCua(custom)).toBe(custom)
  expect(await detectCua(join(directory, 'missing'))).toBeNull()
})

it('rejects directories instead of treating them as executables', async () => {
  const path = join(directory, binary())
  await mkdir(path)
  expect(await detectCua(path)).toBeNull()
})

it('reports version separately from daemon and permission check failures', async () => {
  const path = join(directory, binary())
  await writeFile(path, '', { mode: 0o755 })
  vi.mocked(exec).mockImplementation(async (_command, args) => {
    if (args?.[0] === '--version') return { stdout: 'cua-driver 0.33.1\n', stderr: '' }
    throw new Error('Daemon is not running')
  })
  const result = await checkCua(path)
  expect(result).toMatchObject({ available: true, path, version: 'cua-driver 0.33.1' })
  expect(result.daemon).toContain('Daemon is not running')
  expect(result.detail).toContain('Desktop control has not been tested')
  expect(vi.mocked(exec).mock.calls.every(([command]) => command === path)).toBe(true)
  expect(result.permissions).toEqual(
    process.platform === 'darwin' ? 'Check failed: Error: Daemon is not running' : null,
  )
})

it('reports an executable that fails to launch without attempting desktop probes', async () => {
  const path = join(directory, binary())
  await writeFile(path, '', { mode: 0o755 })
  vi.mocked(exec).mockRejectedValue(new Error('Invalid executable'))
  expect(await checkCua(path)).toMatchObject({
    available: false,
    path,
    version: null,
    daemon: null,
    permissions: null,
  })
  expect(exec).toHaveBeenCalledTimes(1)
})

it('returns actionable missing-path diagnostics without launching a process', async () => {
  const result = await checkCua(join(directory, 'missing'))
  expect(result).toMatchObject({ available: false, path: null })
  expect(result.detail).toContain('configured')
  expect(exec).not.toHaveBeenCalled()
})

it('does not report another program as an installed Cua Driver', async () => {
  const path = join(directory, binary())
  await writeFile(path, '', { mode: 0o755 })
  vi.mocked(exec).mockResolvedValue({ stdout: 'v26.8.1', stderr: '' })
  const result = await checkCua(path)
  expect(result.available).toBe(false)
  expect(result.detail).toContain('did not identify itself as Cua Driver')
  expect(exec).toHaveBeenCalledTimes(1)
})

it('only supplies desktop tools to writable agents on an opted-in computer', async () => {
  const path = join(directory, binary())
  await writeFile(path, '', { mode: 0o755 })
  const disabled = decode(commandsSchema, { cua: path })
  expect(await cuaAgentServer(disabled, 'full-access')).toBeUndefined()
  const enabled = { ...disabled, cuaEnabled: true }
  expect(await cuaAgentServer(enabled, 'read-only')).toBeUndefined()
  for (const permission of ['ask', 'workspace-write', 'auto', 'full-access'] as const) {
    expect(await cuaAgentServer(enabled, permission)).toMatchObject({
      name: 'dovo_cua',
      enabled: true,
      transport: 'stdio',
      command: path,
      args: ['mcp'],
    })
  }
  expect(exec).not.toHaveBeenCalled()
})

it('fails clearly if desktop tools are enabled with a missing driver', async () => {
  const enabled = decode(commandsSchema, { cua: join(directory, 'missing'), cuaEnabled: true })
  await expect(cuaAgentServer(enabled, 'ask')).rejects.toThrow('Computer use is enabled')
  expect(await cuaAgentServer(enabled, 'read-only')).toBeUndefined()
})

it('detects the standard install folder even when a desktop process has an older PATH', async () => {
  const install =
    process.platform === 'win32'
      ? join(directory, 'Programs', 'Cua', 'cua-driver', 'bin')
      : join(directory, '.local', 'bin')
  await mkdir(install, { recursive: true })
  const path = join(install, binary())
  await writeFile(path, '', { mode: 0o755 })
  expect(await detectCua('')).toBe(path)
  expect(await detectCua('explicit-missing-command')).toBeNull()
})
