import { afterEach, expect, it, vi } from 'vite-plus/test'
import { openDatabase } from '../../../storage/database'
import { GitService } from '../../git/git'
import { ForgeConnections } from './forge-connections'
import { verifySourceContext } from './source-context'

const cleanup: Array<() => void> = []
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close()
  vi.useRealTimers()
  vi.restoreAllMocks()
})
function setup() {
  const db = openDatabase(':memory:')
  cleanup.push(() => db.close())
  const connections = new ForgeConnections(db)
  const git = new GitService()
  let token = 'first-credential'
  vi.spyOn(git, 'githubCredential').mockImplementation(async () => ({ host: 'github.com', token }))
  const user = vi
    .spyOn(git, 'githubAccount')
    .mockImplementation(async (_args, _limits, _cwd, credential) =>
      JSON.stringify({ id: credential?.token === 'first-credential' ? 1 : 2, login: 'viewer' }),
    )
  const verify = (repository = 'team/project', refresh = false) =>
    verifySourceContext(
      git,
      connections,
      '/repo',
      repository,
      'github.com',
      undefined,
      repository,
      () => {},
      refresh,
    )
  return {
    verify,
    user,
    rotate: () => {
      token = 'second-credential'
    },
  }
}
it('shares verification across concurrent reads and repositories while isolating changed credentials', async () => {
  const f = setup()
  const [first, other] = await Promise.all([f.verify(), f.verify('team/other')])
  expect(f.user).toHaveBeenCalledTimes(1)
  expect(first.readerIdentity).toBe(other.readerIdentity)
  expect(first.destination).not.toBe(other.destination)
  expect((await f.verify()).destination).toBe(first.destination)
  expect(f.user).toHaveBeenCalledTimes(1)
  f.rotate()
  expect((await f.verify()).readerIdentity).not.toBe(first.readerIdentity)
  expect(f.user).toHaveBeenCalledTimes(2)
})
it('revalidates on explicit refresh and expiry without caching failed authentication', async () => {
  vi.useFakeTimers()
  const f = setup()
  await f.verify()
  await f.verify('team/project', true)
  expect(f.user).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(600_001)
  await f.verify()
  expect(f.user).toHaveBeenCalledTimes(3)
  f.user.mockRejectedValueOnce(new Error('Authentication failed'))
  await expect(f.verify('team/project', true)).rejects.toThrow('Authentication failed')
  await f.verify()
  expect(f.user).toHaveBeenCalledTimes(5)
})
it('invalidates every context sharing a rejected credential before it can dispatch another read', async () => {
  const f = setup()
  const first = await f.verify()
  const second = await f.verify('team/other')
  second.github?.onUnauthorized?.()
  expect(() => first.validate()).toThrow('Authentication failed')
  expect(() => second.validate()).toThrow('Authentication failed')
  await f.verify()
  expect(f.user).toHaveBeenCalledTimes(2)
})
