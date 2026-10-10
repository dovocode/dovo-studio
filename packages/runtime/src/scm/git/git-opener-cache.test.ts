import { afterEach, expect, it, vi } from 'vite-plus/test'
import { GitService } from './git'
import { detectInstalledOpeners } from './installed-openers'
import { exec } from '../../process'
vi.mock('./installed-openers', () => ({
  detectInstalledOpeners: vi.fn<typeof detectInstalledOpeners>(),
}))
vi.mock('../repositories/paths', async (original) => ({
  ...(await original<typeof import('../repositories/paths')>()),
  repositoryPath: async (path: string) => path,
}))
vi.mock('../../process', async (original) => ({
  ...(await original<typeof import('../../process')>()),
  exec: vi.fn<typeof exec>(),
}))
afterEach(() => vi.restoreAllMocks())
it('rescans instead of inheriting a concurrent menu discovery failure when opening a checkout', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  let reject = (_error: Error) => {}
  const pending = new Promise<Awaited<ReturnType<typeof detectInstalledOpeners>>>(
    (_resolve, rejectPromise) => {
      reject = rejectPromise
    },
  )
  vi.mocked(detectInstalledOpeners)
    .mockReset()
    .mockImplementationOnce(() => pending)
    .mockResolvedValue([
      { target: 'vscode', executable: '/Applications/Code.app', kind: 'app', prefix: [] },
    ])
  vi.mocked(exec).mockResolvedValue({ stdout: '', stderr: '' })
  const git = new GitService()
  const listed = git.openTargets().catch((error: unknown) => error)
  const opening = git.openFolder('/checkout', 'vscode')
  await Promise.resolve()
  reject(new Error('Menu discovery failed'))
  expect(await listed).toMatchObject({ message: 'Menu discovery failed' })
  await expect(opening).resolves.toBeUndefined()
  expect(detectInstalledOpeners).toHaveBeenCalledTimes(2)
  expect(exec).toHaveBeenCalledWith(
    '/usr/bin/open',
    ['-a', '/Applications/Code.app', '/checkout'],
    expect.anything(),
  )
})
