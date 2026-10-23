import { afterEach, expect, it, vi } from 'vite-plus/test'
import process from 'node:process'
import { desktopLocked } from './desktop-lock.js'
import { exec } from '../process.js'

vi.mock('../process.js', () => ({ exec: vi.fn<typeof exec>() }))
afterEach(() => vi.restoreAllMocks())

it.each(['linux', 'win32'] as const)('does not run a macOS probe on %s', async (platform) => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
  vi.mocked(exec).mockClear()
  expect(await desktopLocked()).toBe(false)
  expect(exec).not.toHaveBeenCalled()
})

it.each([
  ['true\n', true],
  ['false\n', false],
] as const)('reads the native console lock flag %s', async (stdout, locked) => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  vi.mocked(exec).mockResolvedValue({ stdout, stderr: '' })
  expect(await desktopLocked()).toBe(locked)
})

it('does not treat a failed or unrecognized probe as an unlocked Mac', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  vi.mocked(exec).mockResolvedValue({ stdout: 'unavailable', stderr: '' })
  await expect(desktopLocked()).rejects.toThrow('unrecognized desktop lock state')
  vi.mocked(exec).mockRejectedValue(new Error('Console unavailable'))
  await expect(desktopLocked()).rejects.toThrow('Console unavailable')
})
