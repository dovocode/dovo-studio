import { expect, it, vi } from 'vite-plus/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decode, snapshotSchema } from '@dovo/protocol'
import { startRuntime } from '../../index'
import { fixture } from '../../testing/fixture'
import { waitForRuntime } from '../../testing/integration'
import type { AgentAdapter } from './types'

it('schedules a single timed retry through the paired client and keeps it across restart', async () => {
  const f = await fixture()
  const state = await mkdtemp(join(tmpdir(), 'dovo-quota-retry-'))
  const options = {
    databasePath: join(state, 'runtime.sqlite'),
    port: 0,
    ownerToken: 'quota-stop-owner-token-at-least-32-chars',
  }
  let runtime = await startRuntime(options)
  const request = (path: string, input?: object, token = options.ownerToken, agent = false) =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: input ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(agent ? { 'x-dovo-agent-access': '1' } : {}),
      },
      body: input ? JSON.stringify(input) : undefined,
    })
  try {
    const s = runtime.services
    s.store.update(() => f.workspace)
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
      title: 'Quota retry',
      agentId: 'agent',
      repositoryId: 'repo',
      objective: 'Work',
    })
    await expect((await s.tasks.start(task.id)).done).rejects.toThrow('Usage limit reached')
    const failed = s.store.taskSummary(task.id)
    expect(failed).toMatchObject({ status: 'failed', runPhase: undefined, activeRunId: undefined })
    const at = new Date(reset * 1000).toISOString()
    const turnId = failed.history.latestTurn!.id
    expect(failed.history.latestTurn?.quotaRetryAt).toBe(at)
    expect(failed.quotaContinuation).toBeUndefined()
    const snapshot = decode(snapshotSchema, await (await request('/api/snapshot')).json())
    expect(snapshot.quotaResumeSupported).toBe(true)
    expect(snapshot.workspace.tasks[0]?.turns?.at(-1)?.quotaRetryAt).toBe(at)
    const input = { id: task.id, turnId }
    const schedule = '/api/tasks/quota/schedule'
    const cancel = '/api/tasks/quota/cancel'
    expect((await request(schedule, { ...input, turnId: 'old' })).status).toBe(409)
    expect((await request(schedule, { ...input, at: '2026-01-01T00:00:00Z' })).status).toBe(400)
    expect((await request(schedule, input, 'unpaired')).status).toBe(401)
    expect((await request(schedule, input, options.ownerToken, true)).status).toBe(403)
    expect((await request(schedule, input)).status).toBe(200)
    expect((await request(schedule, input)).status).toBe(200)
    expect(s.store.taskSummary(task.id).quotaContinuation).toEqual({
      turnId,
      at,
      resume: true,
      requested: true,
    })
    expect((await request(cancel, input)).status).toBe(200)
    expect(s.store.taskSummary(task.id).quotaContinuation).toBeUndefined()
    expect((await request(schedule, input)).status).toBe(200)
    s.store.updateTask(task.id, (task) => ({ ...task, draft: 'Keep this draft' }))

    await runtime.close()
    runtime = await startRuntime(options)
    const restarted = runtime.services
    const run = vi.fn<AgentAdapter['run']>(async (input) => input.onText('Resumed'))
    vi.spyOn(restarted.agents, 'get').mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run,
    })
    const now = vi.spyOn(Date, 'now').mockReturnValue(reset * 1000 - 1)
    await restarted.tasks.runScheduled()
    expect(run).not.toHaveBeenCalled()
    expect(restarted.store.taskSummary(task.id).quotaContinuation?.at).toBe(at)
    now.mockReturnValue(reset * 1000)
    await restarted.tasks.runScheduled()
    await waitForRuntime(() => expect(restarted.store.taskSummary(task.id).status).toBe('review'))
    await restarted.tasks.runScheduled()
    expect(run).toHaveBeenCalledTimes(1)
    expect(restarted.store.task(task.id)).toMatchObject({
      draft: 'Keep this draft',
      messages: expect.arrayContaining([expect.objectContaining({ text: 'Resumed' })]),
    })
    expect(restarted.store.taskSummary(task.id).quotaContinuation).toBeUndefined()
  } finally {
    vi.restoreAllMocks()
    await runtime.close()
    await rm(state, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    await f.cleanup()
  }
})
it.each(['codex', 'claude'] as const)(
  'persists a %s quota continuation after provider finalization',
  async (provider) => {
    const f = await fixture()
    const runtime = await startRuntime({
      databasePath: ':memory:',
      port: 0,
      ownerToken: 'quota-stop-owner-token-at-least-32-chars',
    })
    try {
      const s = runtime.services
      s.store.update(() => ({
        ...f.workspace,
        agents: f.workspace.agents.map((agent) => ({ ...agent, provider })),
      }))
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
      const failure =
        provider === 'codex'
          ? 'Usage limit reached'
          : 'You’ve hit your limit · resets 8am (America/New_York)'
      vi.spyOn(s.agents, 'get').mockResolvedValue({
        probe: vi.fn<AgentAdapter['probe']>(),
        run: async (input) => {
          if (provider === 'codex')
            input.onEvent?.('account/rateLimits/updated', {
              rateLimits: {
                primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: reset },
              },
            })
          else
            input.onEvent?.('rate_limit_event', {
              rate_limit_info: { status: 'rejected', resetsAt: reset },
            })
          throw new Error(failure)
        },
      })
      const task = s.tasks.create({
        title: 'Quota stop',
        agentId: 'agent',
        repositoryId: 'repo',
        objective: 'Work',
      })
      await expect((await s.tasks.start(task.id)).done).rejects.toThrow(failure)
      const stopped = s.store.task(task.id)
      expect(stopped.status).toBe('failed')
      expect(stopped.error).toContain(failure)
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
  },
)
