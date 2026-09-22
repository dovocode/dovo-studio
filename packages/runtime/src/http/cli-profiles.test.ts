import { afterEach, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { startRuntime } from '../index.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanups.splice(0).reverse()) await close()
})

it('discovers CLI profiles in the selected registered checkout and returns only account metadata', async () => {
  const token = randomBytes(32).toString('base64url')
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(() => runtime.close())
  runtime.services.store.update((workspace) => ({
    ...workspace,
    repositories: [{ id: 'repo', name: 'Project', path: '/projects/checkout', branch: 'main' }],
  }))
  const discovered = {
    profiles: [{ id: 'work', name: 'Work', username: 'developer', token: 'private-cli-token' }],
  }
  const profiles = vi.spyOn(runtime.services.forgeCli, 'profiles').mockResolvedValue(discovered)
  const call = (input: unknown, credential = token) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/scm/cli-profiles/read`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  const input = {
    provider: 'bitbucket',
    baseUrl: 'https://api.bitbucket.org/2.0',
    repositoryId: 'repo',
  }
  expect((await call(input, 'invalid')).status).toBe(401)
  expect((await call({ ...input, repositoryId: 'missing' })).status).toBe(404)
  expect(profiles).not.toHaveBeenCalled()
  const response = await call(input)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    profiles: [{ id: 'work', name: 'Work', username: 'developer' }],
  })
  expect(profiles).toHaveBeenCalledWith(input, '/projects/checkout')
  const history = runtime.services.activity.list('', 'integration', 0, '')
  expect(JSON.stringify(history)).not.toContain('/api/scm/cli-profiles/read')
})

it('supports initial account setup without accepting a client-supplied arbitrary command directory', async () => {
  const token = randomBytes(32).toString('base64url')
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(() => runtime.close())
  const profiles = vi
    .spyOn(runtime.services.forgeCli, 'profiles')
    .mockResolvedValue({ profiles: [] })
  const response = await fetch(`http://127.0.0.1:${runtime.port}/api/scm/cli-profiles/read`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'github',
      baseUrl: 'https://github.com',
      cwd: '/unregistered',
    }),
  })
  expect(response.status).toBe(200)
  expect(profiles).toHaveBeenCalledWith(
    { provider: 'github', baseUrl: 'https://github.com' },
    undefined,
  )
})
