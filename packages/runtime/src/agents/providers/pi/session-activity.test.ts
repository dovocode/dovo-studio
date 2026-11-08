import { afterEach, expect, it, vi } from 'vite-plus/test'
import * as fs from 'node:fs/promises'
import { piSessionActivity } from './session-activity.js'

vi.mock('node:fs/promises', async (original) => ({
  ...(await original<typeof import('node:fs/promises')>()),
}))
afterEach(() => vi.restoreAllMocks())

it.skipIf(process.platform !== 'linux' || !process.getuid)(
  'fails closed for unknown Node processes and detects Pi',
  async () => {
    vi.spyOn(fs, 'readdir').mockResolvedValue(['987654'] as never)
    vi.spyOn(fs, 'stat').mockResolvedValue({ uid: process.getuid?.() } as never)
    const read = vi.spyOn(fs, 'readFile')
    read.mockResolvedValueOnce('/usr/bin/node\0/home/user/other.js\0' as never)
    expect(await piSessionActivity()).toBe('unknown')
    read.mockResolvedValueOnce(
      '/usr/bin/node\0/usr/lib/node_modules/@mariozechner/pi-coding-agent/dist/cli.js\0' as never,
    )
    expect(await piSessionActivity()).toBe('active')
    read.mockResolvedValueOnce('/usr/bin/other\0' as never)
    expect(await piSessionActivity()).toBe('inactive')
  },
)
