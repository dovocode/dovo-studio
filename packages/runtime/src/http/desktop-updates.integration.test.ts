import { afterEach, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { startRuntime } from '../index.js'
import { fixture } from '../testing/fixture.js'
import { runtimeIntegration } from '../testing/integration.js'
import { registerRemoteUpdates } from '../../../../apps/desktop/electron/remote-updates.js'
import type { DesktopUpdateState } from '@dovo/protocol'
vi.setConfig(runtimeIntegration)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.unstubAllEnvs()
})
it('allows a paired device to download and explicitly restart its desktop while protecting active tasks', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const directory = f.directory
  vi.stubEnv('DOVO_RELEASE_DISTRIBUTION', 'desktop')
  vi.stubEnv('DOVO_RELEASE_VERSION', '1.0.0')
  vi.stubEnv('DOVO_DATABASE_PATH', join(directory, 'runtime.sqlite'))
  let state: DesktopUpdateState = { status: 'available', version: '1.0.1' }
  const remote = vi.fn<(action: 'download' | 'restart', version: string) => Promise<void>>(
    async (action, version) => {
      state = { status: action === 'download' ? 'downloaded' : 'restarting', version }
    },
  )
  const close = await registerRemoteUpdates(directory, {
    supported: true,
    state: () => state,
    remote,
  })
  if (!close) throw new Error('Missing desktop update bridge')
  cleanups.push(close)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: randomBytes(32).toString('hex'),
    port: 0,
  })
  cleanups.push(() => runtime.close())
  runtime.services.store.update(() => f.workspace)
  runtime.services.tasks.create({
    title: 'Existing task',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  const token = randomBytes(32).toString('hex')
  runtime.services.devices.add('Phone', token)
  const request = (path: string, authenticated = true, version?: string) =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: version ? 'POST' : 'GET',
      headers: authenticated ? { Authorization: `Bearer ${token}` } : {},
      body: version ? JSON.stringify({ version }) : undefined,
    })
  expect((await request('/api/runtime/update/status', false)).status).toBe(401)
  expect(await (await request('/api/snapshot')).json()).toMatchObject({
    releaseCanUpdate: true,
    releaseDistribution: 'desktop',
  })
  expect((await request('/api/runtime/update/start', true, '1.0.1')).status).toBe(200)
  await vi.waitFor(() => expect(remote).toHaveBeenCalledWith('download', '1.0.1'))
  expect(await (await request('/api/runtime/update/status')).json()).toMatchObject({
    status: 'downloaded',
  })
  runtime.services.store.update((workspace) => ({
    ...workspace,
    tasks: workspace.tasks.map((task) => ({ ...task, status: 'running' })),
  }))
  expect((await request('/api/runtime/update/restart', true, '1.0.1')).status).toBe(409)
  expect(remote).toHaveBeenCalledTimes(1)
  runtime.services.store.update((workspace) => ({
    ...workspace,
    tasks: workspace.tasks.map((task) => ({ ...task, status: 'review' })),
  }))
  expect((await request('/api/runtime/update/restart', true, '1.0.1')).status).toBe(200)
  await vi.waitFor(() => expect(remote).toHaveBeenCalledWith('restart', '1.0.1'))
})
