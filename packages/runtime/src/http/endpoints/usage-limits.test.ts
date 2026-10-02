import { expect, it, vi } from 'vitest'
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
