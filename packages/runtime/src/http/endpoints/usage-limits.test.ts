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

it('refreshes local providers and external hubs independently while retaining combined responses for older clients', async () => {
  const token = randomBytes(32).toString('base64url'),
    f = await fixture()
  const runtime = await startRuntime({
    databasePath: join(f.directory, 'independent.sqlite'),
    ownerToken: token,
    port: 0,
  })
  let release: () => void = () => {}
  try {
    runtime.services.store.update(() => f.workspace)
    let entered: () => void = () => {}
    const started = new Promise<void>((resolve) => (entered = resolve)),
      gate = new Promise<void>((resolve) => (release = resolve))
    const hubs = vi.spyOn(runtime.services.store.usageHubs, 'read').mockImplementation(async () => {
      entered()
      await gate
      return []
    })
    vi.mocked(readUsageLimits).mockResolvedValue({ account: undefined, limits: [] })
    const call = (section?: 'local' | 'hubs') =>
      fetch(`http://127.0.0.1:${runtime.port}/api/usage/limits/read`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true, section }),
      })
    const pending = call('hubs')
    await started
    expect(await (await call('local')).json()).toMatchObject({
      accounts: [{ status: 'unsupported' }],
    })
    expect(hubs).toHaveBeenCalledOnce()
    release()
    expect(await (await pending).json()).toMatchObject({ hubs: [], accounts: [] })
    expect(await (await call()).json()).toMatchObject({
      hubs: [],
      accounts: [{ status: 'unsupported' }],
    })
  } finally {
    release()
    await runtime.close()
    await f.cleanup()
  }
})

it('does not replace a newer quota observation when a slower account probe completes', async () => {
  const token = randomBytes(32).toString('base64url'),
    f = await fixture()
  const runtime = await startRuntime({
    databasePath: join(f.directory, 'race.sqlite'),
    ownerToken: token,
    port: 0,
  })
  let release: () => void = () => {}
  try {
    runtime.services.store.update(() => f.workspace)
    let entered: () => void = () => {}
    const started = new Promise<void>((resolve) => (entered = resolve))
    const gate = new Promise<void>((resolve) => (release = resolve))
    const account = { id: 'account', label: 'Account' }
    const limit = {
      provider: 'codex' as const,
      account,
      bucketId: 'codex',
      windowId: 'primary',
      window: 'Session',
      usedPercent: 20,
      updatedAt: new Date().toISOString(),
    }
    vi.mocked(readUsageLimits).mockImplementationOnce(async () => {
      entered()
      await gate
      return { account, limits: [limit] }
    })
    const pending = fetch(`http://127.0.0.1:${runtime.port}/api/usage/limits/read`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: true, section: 'local' }),
    })
    await started
    const newer = {
      ...limit,
      usedPercent: 45,
      updatedAt: new Date(Date.now() + 1000).toISOString(),
    }
    runtime.services.store.update((workspace) => ({ ...workspace, planLimits: [newer] }))
    release()
    expect((await pending).status).toBe(200)
    expect(runtime.services.store.get().planLimits).toEqual([newer])
  } finally {
    release()
    await runtime.close()
    await f.cleanup()
  }
})

it.each(['changed', 'unchanged', 'anonymous'] as const)(
  'protects same-millisecond arrivals without freezing pre-existing readings: %s',
  async (scenario) => {
    const token = randomBytes(32).toString('base64url'),
      f = await fixture()
    const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
    let release: () => void = () => {}
    try {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-10-29T21:00:00.000Z'))
      const account = { id: 'account', label: 'Account' }
      const limit = {
        provider: 'codex' as const,
        account,
        agentId: 'agent',
        bucketId: 'codex',
        windowId: 'primary',
        window: 'Session',
        usedPercent: 10,
        updatedAt: new Date().toISOString(),
      }
      runtime.services.store.update(() => ({ ...f.workspace, planLimits: [limit] }))
      let entered: () => void = () => {}
      const started = new Promise<void>((resolve) => (entered = resolve))
      const gate = new Promise<void>((resolve) => (release = resolve))
      vi.mocked(readUsageLimits).mockImplementationOnce(async () => {
        entered()
        await gate
        return { account, limits: [{ ...limit, usedPercent: 20 }] }
      })
      const pending = fetch(`http://127.0.0.1:${runtime.port}/api/usage/limits/read`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true, section: 'local' }),
      })
      await started
      const observed = {
        ...limit,
        account: scenario === 'anonymous' ? undefined : account,
        usedPercent: scenario === 'unchanged' ? 10 : 45,
      }
      // Rewriting an unchanged reading also clones the validated workspace values;
      // reference identity alone must not mistake that for a new observation.
      runtime.services.store.update((workspace) => ({ ...workspace, planLimits: [observed] }))
      release()
      expect((await pending).status).toBe(200)
      expect(runtime.services.store.get().planLimits).toEqual([
        scenario === 'unchanged' ? { ...limit, usedPercent: 20 } : observed,
      ])
    } finally {
      release()
      vi.useRealTimers()
      await runtime.close()
      await f.cleanup()
    }
  },
)
