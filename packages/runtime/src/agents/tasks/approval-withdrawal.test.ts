import { waitForRuntime } from '../../testing/integration'
import type { AgentAdapter } from '../execution/types'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { startRuntime } from '../../index'
import { fixture } from '../../testing/fixture'

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

it('closes an approval card when the provider withdraws its request during the turn', async () => {
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
  const provider = new AbortController()
  let release = () => {}
  const finish = new Promise<void>((resolve) => (release = resolve))
  const decisions: string[] = []
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      decisions.push(
        await run.approve(
          'Run command',
          '{"command":"echo harmless"}',
          'command',
          undefined,
          provider.signal,
        ),
      )
      // The turn stays active after the provider withdraws its request.
      await finish
      run.onText('Done')
    },
  })
  const task = s.tasks.create({
    title: 'Withdrawn approval',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Test',
    execution: 'main',
  })
  const execution = await s.tasks.start(task.id)
  await waitForRuntime(() => expect(s.approvals.list()).toHaveLength(1))
  const [{ id }] = s.approvals.list()
  provider.abort()
  await waitForRuntime(() => expect(decisions).toEqual(['deny']))
  expect(s.approvals.list()).toEqual([])
  expect(s.store.task(task.id).status).toBe('running')
  expect(() => s.approvals.decide(id, 'always')).toThrow('approval request was withdrawn')
  expect(s.store.get().repositories[0]?.approvedCommands).toBeUndefined()
  release()
  await execution.done
})
