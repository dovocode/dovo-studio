import { afterEach, expect, it, vi } from 'vite-plus/test'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { androidTool } from './android-tool'

const access = vi.hoisted(() => vi.fn<typeof import('node:fs/promises').access>())
vi.mock('node:fs/promises', () => ({ access }))

afterEach(() => {
  access.mockReset()
  vi.unstubAllEnvs()
})

const fallback = join(
  homedir(),
  process.platform === 'darwin' ? 'Library/Android/sdk' : 'Android/Sdk',
)
const filename = (root: string, tool: 'adb' | 'emulator') =>
  join(
    root,
    tool === 'adb' ? 'platform-tools' : 'emulator',
    process.platform === 'win32' ? `${tool}.exe` : tool,
  )

it('prefers ANDROID_HOME over ANDROID_SDK_ROOT and uses platform-specific tool names', async () => {
  const root = join(tmpdir(), 'preferred-sdk')
  vi.stubEnv('ANDROID_HOME', root)
  vi.stubEnv('ANDROID_SDK_ROOT', join(tmpdir(), 'secondary-sdk'))
  access.mockResolvedValue(undefined)
  expect(await androidTool('adb')).toBe(filename(root, 'adb'))
  expect(await androidTool('emulator')).toBe(filename(root, 'emulator'))
  expect(access.mock.calls.map(([path]) => path)).toEqual([
    filename(root, 'adb'),
    filename(root, 'emulator'),
  ])
})

it('uses ANDROID_SDK_ROOT when ANDROID_HOME is unset, then falls back to the home SDK', async () => {
  const root = join(tmpdir(), 'secondary-sdk')
  vi.stubEnv('ANDROID_HOME', undefined)
  vi.stubEnv('ANDROID_SDK_ROOT', root)
  access.mockRejectedValueOnce(new Error('SDK is unavailable')).mockResolvedValue(undefined)
  expect(await androidTool('adb')).toBe(filename(fallback, 'adb'))
  expect(access.mock.calls.map(([path]) => path)).toEqual([
    filename(root, 'adb'),
    filename(fallback, 'adb'),
  ])
})

it('checks an identical SDK path only once before falling back to PATH', async () => {
  vi.stubEnv('ANDROID_HOME', fallback)
  access.mockRejectedValue(new Error('SDK is unavailable'))
  expect(await androidTool('adb')).toBe('adb')
  expect(access).toHaveBeenCalledExactlyOnceWith(filename(fallback, 'adb'))
})
