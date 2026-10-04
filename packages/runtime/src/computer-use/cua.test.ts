import { decode, commandsSchema } from '@dovo/protocol'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkCua, detectCua, cuaAgentServer, cuaAction, cuaSkillInstructions } from './cua.js'
import { exec, ProcessError } from '../process.js'

vi.mock('../process.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../process.js')>()),
  exec: vi.fn<typeof exec>(),
  processEnvironment: () => ({}),
}))
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

it('runs only fixed action arguments and returns fresh driver status', async () => {
  const path = join(directory, binary())
  await writeFile(path, '', { mode: 0o755 })
  vi.mocked(exec).mockImplementation(async (_command, args) => ({
    stdout: args?.[0] === '--version' ? 'cua-driver 0.33.1' : 'result',
    stderr: '',
  }))
  const result = await cuaAction(path, 'history-list')
  expect(result.output).toBe('result')
  expect(result.check).toMatchObject({ available: true, history: 'result', skills: 'result' })
  expect(exec).toHaveBeenCalledWith(
    path,
    ['history', 'list', '20'],
    expect.objectContaining({ timeout: 60000, windowsHide: true }),
  )
  expect(vi.mocked(exec).mock.calls.every(([command]) => command === path)).toBe(true)
})

it('does not run setup actions against an unrecognized executable', async () => {
  const path = join(directory, binary())
  await writeFile(path, '', { mode: 0o755 })
  vi.mocked(exec).mockResolvedValue({ stdout: 'Some other app', stderr: '' })
  await expect(cuaAction(path, 'history-enable')).rejects.toThrow('did not identify itself')
  expect(exec).toHaveBeenCalledTimes(1)
})

it('serializes shared daemon setup and releases the lock after failure', async () => {
  const path = join(directory, binary())
  await writeFile(path, '', { mode: 0o755 })
  vi.mocked(exec).mockImplementation(async (_command, args) => {
    if (args?.[0] === '--version') return { stdout: 'cua-driver 0.33.1', stderr: '' }
    if (args?.[0] === 'stop') throw new Error('stop failed')
    return { stdout: 'status', stderr: '' }
  })
  const first = cuaAction(path, 'stop')
  await expect(cuaAction(path, 'history-enable')).rejects.toThrow('Another Cua setup action')
  await expect(first).rejects.toThrow('stop failed')
  await expect(cuaAction(path, 'history-pause')).resolves.toMatchObject({ output: 'status' })
})

it.runIf(process.platform === 'darwin')(
  'starts the macOS permission-owning app rather than a shell daemon',
  async () => {
    const path = join(directory, binary())
    await writeFile(path, '', { mode: 0o755 })
    vi.mocked(exec).mockImplementation(async (_command, args) => ({
      stdout: args?.[0] === '--version' ? 'cua-driver 0.33.1' : 'ok',
      stderr: '',
    }))
    await cuaAction(path, 'start')
    expect(exec).toHaveBeenCalledWith(
      '/usr/bin/open',
      ['-n', '-g', '-a', 'CuaDriver', '--args', 'serve'],
      expect.anything(),
    )
  },
)

it('exposes an installed official skill source to isolated harnesses', async () => {
  const skill = join(directory, 'skill with spaces')
  await mkdir(skill)
  await writeFile(join(skill, 'SKILL.md'), '# Official Cua skill')
  vi.mocked(exec).mockResolvedValue({ stdout: skill, stderr: '' })
  expect(await cuaSkillInstructions('cua-driver')).toContain(
    JSON.stringify(join(skill, 'SKILL.md')),
  )
  await rm(join(skill, 'SKILL.md'))
  expect(await cuaSkillInstructions('cua-driver')).toContain('not installed')
  vi.mocked(exec).mockRejectedValue(new Error('unsupported command'))
  expect(await cuaSkillInstructions('cua-driver')).toContain('unsupported command')
})

it('validates history state and preserves unsupported-version diagnostics', async () => {
  const path = join(directory, binary())
  await writeFile(path, '', { mode: 0o755 })
  const state = {
    admitted: true,
    enabled: true,
    paused: false,
    encrypted: true,
    supported: true,
    health: 'ok',
  }
  let history = JSON.stringify(state)
  vi.mocked(exec).mockImplementation(async (_command, args) => ({
    stdout:
      args?.[0] === '--version'
        ? 'cua-driver 0.33.2'
        : args?.[0] === 'history'
          ? history
          : 'status',
    stderr: '',
  }))
  expect((await checkCua(path)).historyState).toEqual(state)
  history = JSON.stringify({ ...state, enabled: 'yes' })
  expect((await checkCua(path)).historyState).toBeNull()
  history = 'Computer History is unsupported'
  expect(await checkCua(path)).toMatchObject({ historyState: null, history })
})

it('keeps driver errors visible and never retries a failed action', async () => {
  const path = join(directory, binary())
  await writeFile(path, '', { mode: 0o755 })
  vi.mocked(exec).mockImplementation(async (_command, args) => {
    if (args?.[0] === 'history' && args?.[1] === 'enable')
      throw new ProcessError({
        message: 'Command failed',
        cause: new Error('timeout'),
        stdout: '',
        stderr: 'History could not be enabled',
      })
    return { stdout: args?.[0] === '--version' ? 'cua-driver 0.33.2' : 'status', stderr: '' }
  })
  await expect(cuaAction(path, 'history-enable')).rejects.toThrow('History could not be enabled')
  expect(
    vi
      .mocked(exec)
      .mock.calls.filter(([, args]) => args?.[0] === 'history' && args?.[1] === 'enable'),
  ).toHaveLength(1)
})
