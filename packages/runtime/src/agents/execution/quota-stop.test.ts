import { expect, it, vi } from 'vite-plus/test'
import { startRuntime } from '../../index'
import { fixture } from '../../testing/fixture'
import type { AgentAdapter } from './types'
it('persists a quota continuation after provider finalization, without hiding the failure', async () => {
  const f = await fixture()
  const runtime = await startRuntime({
    databasePath: ':memory:',
    port: 0,
    ownerToken: 'quota-stop-owner-token-at-least-32-chars',
  })
  try {
    const s = runtime.services
    s.store.update(() => f.workspace)
    s.defaults.save(
      {
        ...s.defaults.get(),
        scopedSettings: {
          shared: [],
          environment: { taskBehavior: { quotaResume: true, quotaSnooze: true } },
        },
      },
      false,
    )
    const reset = Math.floor(Date.now() / 1000) + 3600
    vi.spyOn(s.agents, 'get').mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run: async (input) => {
        input.onEvent?.('account/rateLimits/updated', {
          rateLimits: { primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: reset } },
        })
        throw new Error('Usage limit reached')
      },
    })
    const task = s.tasks.create({
      title: 'Quota stop',
      agentId: 'agent',
      repositoryId: 'repo',
      objective: 'Work',
    })
    await expect((await s.tasks.start(task.id)).done).rejects.toThrow('Usage limit reached')
    const stopped = s.store.task(task.id)
    expect(stopped.status).toBe('failed')
    expect(stopped.error).toContain('Usage limit reached')
    expect(stopped.quotaContinuation).toEqual({
      turnId: stopped.turns?.at(-1)?.id,
      at: new Date(reset * 1000).toISOString(),
      resume: true,
    })
    expect(stopped.snoozedUntil).toBe(stopped.quotaContinuation?.at)
  } finally {
    vi.restoreAllMocks()
    await runtime.close()
    await f.cleanup()
  }
})
