import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { ProcessError } from '../../../process'
import { codexSessionActivity } from './session-activity'

const system = vi.hoisted(() => ({
  readdir: vi.fn<(path: string) => Promise<string[]>>(),
  readFile: vi.fn<(path: string, encoding: string) => Promise<string>>(),
  readlink: vi.fn<(path: string) => Promise<string>>(),
  stat: vi.fn<(path: string) => Promise<{ uid: number | undefined }>>(),
  exec: vi.fn<
    (command: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>
  >(),
}))
vi.mock('node:fs/promises', () => ({
  readdir: system.readdir,
  readFile: system.readFile,
  readlink: system.readlink,
  stat: system.stat,
}))
vi.mock('../../../process', async (original) => ({
  ...(await original<typeof import('../../../process')>()),
  exec: system.exec,
}))
const platform = process.platform
const setPlatform = (value: NodeJS.Platform) =>
  Object.defineProperty(process, 'platform', { value, configurable: true })
const failure = (code: string, stderr = '') =>
  new ProcessError({
    message: code,
    cause: Object.assign(new Error(code), { code }),
    code,
    stdout: '',
    stderr,
  })
beforeEach(() => {
  vi.resetAllMocks()
  system.stat.mockResolvedValue({ uid: process.getuid?.() })
  system.readdir.mockImplementation(async (path) => (path === '/proc' ? ['11', '22'] : ['4']))
  system.readlink.mockResolvedValue('/another/file')
  system.readFile.mockImplementation(async (path) =>
    path.endsWith('/stat') ? '11 (codex) S 1 1' : 'codex\n',
  )
})
afterEach(() => setPlatform(platform))

it.each(['ENOENT', 'EACCES', 'ETIMEDOUT'])(
  'keeps macOS ownership unknown when lsof fails with %s',
  async (code) => {
    setPlatform('darwin')
    system.exec.mockRejectedValue(failure(code))
    expect(await codexSessionActivity('/rollout.jsonl')).toBe('unknown')
    expect(system.exec).toHaveBeenCalledWith('lsof', ['-t', '--', '/rollout.jsonl'], {
      timeout: 5000,
      maxBuffer: 64000,
    })
  },
)

it('does not treat an lsof permission warning as evidence that a session is inactive', async () => {
  setPlatform('darwin')
  system.exec.mockRejectedValue(failure('1', 'lsof: permission denied'))
  expect(await codexSessionActivity('/rollout.jsonl')).toBe('unknown')
  system.exec.mockRejectedValue(
    new ProcessError({
      message: 'No match',
      cause: new Error('No match'),
      code: 1,
      stdout: '',
      stderr: 'lsof: permission denied',
    }),
  )
  expect(await codexSessionActivity('/rollout.jsonl')).toBe('unknown')
})

it('accepts only a clean lsof no-match as inactive and recognizes open handles', async () => {
  setPlatform('darwin')
  system.exec.mockRejectedValue(
    new ProcessError({
      message: 'No match',
      cause: new Error('No match'),
      code: 1,
      stdout: '',
      stderr: '',
    }),
  )
  expect(await codexSessionActivity('/rollout.jsonl')).toBe('inactive')
  system.exec.mockResolvedValue({ stdout: '123\n', stderr: '' })
  expect(await codexSessionActivity('/rollout.jsonl')).toBe('active')
  system.exec.mockResolvedValue({ stdout: '', stderr: '' })
  expect(await codexSessionActivity('/rollout.jsonl')).toBe('unknown')
})

it('fails closed for a non-dumpable live Linux provider, but still detects another active owner', async () => {
  setPlatform('linux')
  system.readdir.mockImplementation(async (path) => {
    if (path === '/proc') return ['11', '22']
    if (path === '/proc/11/fd')
      throw Object.assign(new Error('Permission denied'), { code: 'EACCES' })
    return ['4']
  })
  expect(await codexSessionActivity('/rollout.jsonl')).toBe('unknown')
  system.readlink.mockResolvedValue('/rollout.jsonl')
  expect(await codexSessionActivity('/rollout.jsonl')).toBe('active')
})

it('allows dead Linux processes while protecting open deleted rollouts', async () => {
  setPlatform('linux')
  system.readdir.mockImplementation(async (path) => {
    if (path === '/proc') return ['11', '22']
    if (path === '/proc/11/fd') throw Object.assign(new Error('Process exited'), { code: 'EACCES' })
    return ['4']
  })
  system.readFile.mockResolvedValue('11 (codex) Z 1 1')
  expect(await codexSessionActivity('/rollout.jsonl')).toBe('inactive')
  system.readlink.mockResolvedValue('/rollout.jsonl (deleted)')
  expect(await codexSessionActivity('/rollout.jsonl')).toBe('active')
})

it('keeps ownership unknown when procfs cannot be inspected or the host is unsupported', async () => {
  setPlatform('linux')
  system.readdir.mockRejectedValue(
    Object.assign(new Error('Permission denied'), { code: 'EACCES' }),
  )
  expect(await codexSessionActivity('/rollout.jsonl')).toBe('unknown')
  setPlatform('win32')
  expect(await codexSessionActivity('/rollout.jsonl')).toBe('unknown')
  expect(system.exec).not.toHaveBeenCalled()
})
