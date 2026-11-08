import { expect, it, vi } from 'vite-plus/test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { copyWorktreeFiles } from './worktree-include'

const { copy } = vi.hoisted(() => ({ copy: vi.fn<typeof import('node:fs/promises').copyFile>() }))
vi.mock('node:fs/promises', async (original) => ({
  ...(await original<typeof import('node:fs/promises')>()),
  copyFile: copy,
}))

for (const outcome of ['failure', 'abort'] as const)
  it(`bounds copying and drains in-flight writes before reporting ${outcome}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dovo-copy-workers-'))
    const target = join(root, 'target')
    const controller = new AbortController()
    const active: Array<{ resolve: () => void; reject: (error: Error) => void }> = []
    copy
      .mockReset()
      .mockImplementation(
        () => new Promise<void>((resolve, reject) => active.push({ resolve, reject })),
      )
    try {
      await mkdir(target)
      const files = Array.from({ length: 10 }, (_, index) => `${index}.txt`)
      await Promise.all(files.map((file) => writeFile(join(root, file), 'local')))
      let settled = false
      const copying = copyWorktreeFiles(root, target, files, controller.signal).then(
        () => {
          settled = true
          return undefined
        },
        (error: unknown) => {
          settled = true
          return error
        },
      )
      await vi.waitFor(() => expect(active).toHaveLength(4))
      if (outcome === 'abort') controller.abort(new Error('Cancelled'))
      else active[0]!.reject(new Error('Copy failed'))
      // Let the failed worker finish while other writes remain owned by the operation.
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(settled).toBe(false)
      expect(copy).toHaveBeenCalledTimes(4)
      for (const item of active) item.resolve()
      expect(await copying).toMatchObject({
        message: outcome === 'abort' ? 'Cancelled' : 'Copy failed',
      })
      expect(copy).toHaveBeenCalledTimes(4)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
