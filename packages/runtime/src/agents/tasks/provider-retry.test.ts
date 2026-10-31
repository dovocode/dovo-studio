import { afterEach, expect, it, vi } from 'vite-plus/test'
import { defaultTaskHarness } from '@dovo/protocol'
import { startRuntime } from '../../index'
import { fixture } from '../../testing/fixture'
import { runtimeIntegration, waitForRuntime } from '../../testing/integration'
import type { AgentAdapter, AgentRun } from '../execution/types'

vi.setConfig(runtimeIntegration)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

it.each(['completed', 'failed', 'cancelled'] as const)(
  'keeps retry progress run-scoped through %s',
  async (outcome) => {
    const f = await fixture()
    cleanups.push(f.cleanup)
    const runtime = await startRuntime({
      databasePath: ':memory:',
      ownerToken: 'test-owner-token-with-at-least-32-characters',
      port: 0,
    })
    cleanups.push(() => runtime.close())
    const s = runtime.services
    s.store.update(() => f.workspace)
    let release!: () => void
    const done = new Promise<void>((resolve) => {
      release = resolve
    })
    let provider: AgentRun | undefined
    vi.spyOn(s.agents, 'get').mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run: async (run) => {
        provider = run
        run.onEvent?.('assistant', {
          type: 'assistant',
          message: { model: 'claude', usage: { input_tokens: 85000 } },
        })
        run.onEvent?.('assistant', {
          type: 'assistant',
          message: { model: '<synthetic>', usage: { input_tokens: 0 } },
        })
        for (const attempt of [1, 2])
          run.onEvent?.('system', {
            type: 'system',
            subtype: 'api_retry',
            attempt,
            max_retries: 5,
            retry_delay_ms: 1000,
            error_status: 429,
          })
        await done
        run.signal.throwIfAborted()
        if (outcome === 'failed') throw new Error('Provider exhausted its retry budget')
        run.onText('Recovered answer')
      },
    })
    const task = s.tasks.create({
      title: 'Retry status',
      repositoryId: 'repo',
      agentId: 'agent',
      harness: defaultTaskHarness('claude'),
      objective: 'Work',
    })
    const execution = await s.tasks.start(task.id)
    const settled = execution.done.then(
      () => undefined,
      (error: unknown) => error,
    )
    try {
      await waitForRuntime(() =>
        expect(s.store.task(task.id).turns?.at(-1)?.providerRetry).toMatchObject({
          attempt: 2,
          state: 'waiting',
        }),
      )
      expect(s.store.task(task.id).contextUsage?.used).toBe(85000)
      expect(s.store.task(task.id).messages).toHaveLength(2)
      if (outcome === 'cancelled') s.tasks.cancel(task.id)
      release()
      await settled
      const turn = s.store.task(task.id).turns!.at(-1)!
      expect(turn.status).toBe(outcome)
      expect(turn.providerRetry).toMatchObject({
        attempt: 2,
        state: outcome === 'completed' ? 'recovered' : 'waiting',
      })
      provider?.onEvent?.('system', {
        type: 'system',
        subtype: 'api_retry',
        attempt: 99,
        max_retries: 99,
        retry_delay_ms: 1,
        error_status: null,
      })
      expect(s.store.task(task.id).turns!.at(-1)!.providerRetry?.attempt).toBe(2)
    } finally {
      release()
      await settled
    }
  },
)
