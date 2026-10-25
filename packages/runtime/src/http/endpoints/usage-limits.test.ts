import { expect, it, vi } from 'vite-plus/test'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { startRuntime } from '../../index.js'
import { fixture } from '../../testing/fixture.js'
import { readUsageLimits } from '../../agents/tasks/usage-limits.js'
vi.mock('../../agents/tasks/usage-limits.js', () => ({
  readUsageLimits:
    vi.fn<(typeof import('../../agents/tasks/usage-limits.js'))['readUsageLimits']>(),
}))
it('checks limits without a thread, authenticates, coalesces refreshes and preserves readings on failure', async () => {
  const token = randomBytes(32).toString('base64url'),
    f = await fixture()
  const runtime = await startRuntime({
    databasePath: join(f.directory, 'usage.sqlite'),
    ownerToken: token,
    port: 0,
  })
  try {
    runtime.services.store.update(() => f.workspace)
    const call = (force = false, credential = token) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/usage/limits/read`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      })
    vi.mocked(readUsageLimits).mockResolvedValue({
      account: { id: 'account', label: 'Account', subscription: 'pro' },
      limits: [
        {
          provider: 'codex',
          window: 'Session',
          windowId: 'primary',
          bucketId: 'codex',
          usedPercent: 25,
          updatedAt: new Date().toISOString(),
        },
      ],
    })
    expect((await call(false, 'bad')).status).toBe(401)
    expect(await (await call()).json()).toMatchObject({ accounts: [{ status: 'ok' }] })
    expect(runtime.services.store.get().tasks).toHaveLength(0)
    await call()
    expect(readUsageLimits).toHaveBeenCalledTimes(1)
    vi.mocked(readUsageLimits).mockRejectedValue(new Error('Provider unavailable'))
    expect(await (await call(true)).json()).toMatchObject({
      accounts: [{ status: 'failed', reason: 'Provider unavailable' }],
    })
    expect(runtime.services.store.get().planLimits?.[0]?.usedPercent).toBe(25)
    await call()
    expect(readUsageLimits).toHaveBeenCalledTimes(2)
    runtime.services.store.update((w) => ({
      ...w,
      agents: w.agents.map((agent) => ({ ...agent, env: { CODEX_HOME: '/different-home' } })),
    }))
    await call()
    expect(readUsageLimits).toHaveBeenCalledTimes(3)
  } finally {
    await runtime.close()
    await f.cleanup()
  }
})

it('keeps hub management authenticated and never adds management credentials to snapshots or API results', async () => {
  const token = randomBytes(32).toString('base64url'),
    f = await fixture()
  const runtime = await startRuntime({
    databasePath: join(f.directory, 'hubs.sqlite'),
    ownerToken: token,
    port: 0,
  })
  try {
    const call = (path: string, input: unknown, credential = token) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/usage/hubs/${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    const input = {
      label: 'Hub',
      url: 'http://hub.internal:8317',
      enabled: false,
      managementKey: 'do-not-return-this-secret',
    }
    expect((await call('write', input, 'bad')).status).toBe(401)
    const saved = await call('write', input)
    expect(saved.status).toBe(200)
    const value: unknown = await saved.json()
    expect(value).toMatchObject([
      { label: 'Hub', url: 'http://hub.internal:8317/', enabled: false, limits: [] },
    ])
    expect(JSON.stringify(value)).not.toContain(input.managementKey)
    expect(JSON.stringify(runtime.services.store.get())).not.toContain(input.managementKey)
    const bad = await call('write', { ...input, label: 0 })
    expect(bad.status).toBe(400)
    expect(await bad.text()).not.toContain(input.managementKey)
    expect((await call('read', {}, 'bad')).status).toBe(401)
    const activity = runtime.services.activity.list('', 'integration', 0)
    expect(JSON.stringify(activity)).not.toContain(input.managementKey)
    expect(JSON.stringify(activity)).toContain('[sensitive input not recorded]')
    const [hub] = runtime.services.store.usageHubs.list()
    expect(await (await call('remove', { id: hub!.id })).json()).toEqual([])
  } finally {
    await runtime.close()
    await f.cleanup()
  }
})
