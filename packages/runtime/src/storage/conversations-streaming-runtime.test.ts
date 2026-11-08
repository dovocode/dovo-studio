import { afterEach, expect, it, vi } from 'vite-plus/test'
import { startRuntime } from '../index.js'
import { fixture } from '../testing/fixture.js'
import { runtimeIntegration } from '../testing/integration.js'
import type { AgentAdapter } from '../agents/execution/types.js'

vi.setConfig(runtimeIntegration)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

it('releases the search deferral when provider loading fails before the provider starts', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'search-test-owner-token-at-least-32-characters',
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.store.update(() => f.workspace)
  const begin = s.store.deferHistorySearch.bind(s.store)
  const finish = vi.fn<() => void>()
  const defer = vi.spyOn(s.store, 'deferHistorySearch').mockImplementation((id) => {
    finish.mockImplementation(begin(id))
    return finish
  })
  const run = vi.fn<AgentAdapter['run']>(async (input) => {
    input.onText('Café recovered')
  })
  const load = vi
    .spyOn(s.agents, 'get')
    .mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run,
    })
    .mockRejectedValueOnce(new Error('Provider startup failed'))
  const task = s.tasks.create({
    title: 'Search startup',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Reply',
  })
  const execution = await s.tasks.start(task.id)
  await expect(execution.done).rejects.toThrow('Provider startup failed')
  expect(load).toHaveBeenCalledOnce()
  expect(run).not.toHaveBeenCalled()
  expect(defer).toHaveBeenCalledExactlyOnceWith(task.id)
  expect(finish).toHaveBeenCalledOnce()
  await (
    await s.tasks.start(task.id)
  ).done
  expect(finish).toHaveBeenCalledTimes(2)
  expect(run).toHaveBeenCalledOnce()
  expect(s.store.searchHistory('recovered cafe', task.id).hits).toHaveLength(1)
})

it.each(['completed', 'failed', 'cancelled'] as const)(
  'finishes the search deferral after the last provider flush on a %s turn',
  async (outcome) => {
    const f = await fixture()
    cleanups.push(f.cleanup)
    const runtime = await startRuntime({
      databasePath: ':memory:',
      ownerToken: 'search-test-owner-token-at-least-32-characters',
      port: 0,
    })
    cleanups.push(() => runtime.close())
    const s = runtime.services
    s.store.update(() => f.workspace)
    const begin = s.store.deferHistorySearch.bind(s.store)
    const finish = vi.fn<() => void>()
    const defer = vi.spyOn(s.store, 'deferHistorySearch').mockImplementation((id) => {
      finish.mockImplementation(begin(id))
      return finish
    })
    let providerEntered!: () => void
    let releaseProvider!: () => void
    const entered = new Promise<void>((resolve) => {
      providerEntered = resolve
    })
    const release = new Promise<void>((resolve) => {
      releaseProvider = resolve
    })
    const adapter = vi.fn<AgentAdapter['run']>(async (run) => {
      run.onPromptAccepted?.()
      run.onText('Café first')
      run.onText(' buffered answer')
      providerEntered()
      await release
      if (outcome === 'failed') throw new Error('Provider failed')
    })
    vi.spyOn(s.agents, 'get').mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run: adapter,
    })
    const task = s.tasks.create({
      title: 'Search',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: 'Reply',
    })
    const execution = await s.tasks.start(task.id)
    const settled = Promise.allSettled([execution.done])
    try {
      await entered
      expect(defer).toHaveBeenCalledExactlyOnceWith(task.id)
      expect(finish).not.toHaveBeenCalled()
      expect(s.store.searchHistory('first cafe', task.id).hits).toHaveLength(1)
      expect(s.store.task(task.id).messages.at(-1)!.text).toContain('Café first')
      if (outcome === 'cancelled') s.tasks.cancel(task.id)
    } finally {
      releaseProvider()
    }
    const results = await settled
    expect(results[0]!.status).toBe(outcome === 'completed' ? 'fulfilled' : 'rejected')
    expect(finish).toHaveBeenCalledOnce()
    expect(s.store.task(task.id).turns?.at(-1)?.status).toBe(outcome)
    expect(s.store.task(task.id).messages.at(-1)!.text).toBe('Café first buffered answer')
    expect(s.store.searchHistory('buffered cafe', task.id).hits).toHaveLength(1)
  },
)
