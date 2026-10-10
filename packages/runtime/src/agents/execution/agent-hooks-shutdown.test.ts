import { ChildProcess, spawn } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { expect, it, vi } from 'vite-plus/test'
import { executeHook } from './agent-hooks.js'
import { stopOwnedChild, OwnedProcessShutdownError } from './stop-owned-child.js'
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn: vi.fn<typeof import('node:child_process').spawn>(),
}))
vi.mock('./stop-owned-child.js', async (original) => ({
  ...(await original<typeof import('./stop-owned-child.js')>()),
  stopOwnedChild: vi.fn<typeof import('./stop-owned-child.js').stopOwnedChild>(),
}))
it.each(['abort', 'timeout'])(
  'settles a hook when %s cleanup rejects without a close event',
  async (kind) => {
    vi.clearAllMocks()
    const child = new ChildProcess()
    Object.defineProperty(child, 'stdout', { value: new PassThrough() })
    Object.defineProperty(child, 'stderr', { value: new PassThrough() })
    vi.mocked(spawn).mockReturnValue(child)
    vi.mocked(stopOwnedChild).mockRejectedValue(
      new OwnedProcessShutdownError('Provider shutdown was not confirmed'),
    )
    const controller = new AbortController()
    const pending = executeHook(
      {
        name: 'stuck',
        command: 'ignored',
        event: 'before-turn',
        enabled: true,
        timeoutSeconds: kind === 'timeout' ? 0 : 10,
      },
      process.cwd(),
      controller.signal,
    )
    if (kind === 'abort') controller.abort()
    await expect(pending).rejects.toThrow('shutdown was not confirmed')
    expect(stopOwnedChild).toHaveBeenCalledOnce()
  },
)
