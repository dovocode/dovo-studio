import { afterEach, expect, it, vi } from 'vite-plus/test'
import { defaultTaskHarness, type Task } from '@dovo/protocol'
import { startRuntime } from '../../index'
import { fixture } from '../../testing/fixture'
import { runtimeIntegration, waitForRuntime } from '../../testing/integration'
import type { AgentAdapter } from './types'

vi.setConfig(runtimeIntegration)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

it('stores the latest Muse native todo list, replacing it whole on each update', async () => {
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
  let turn = 0
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      run.onSession('muse-session')
      turn += 1
      if (turn === 1)
        run.onEvent?.('session/todoListChanged', {
          items: [
            { text: 'Step one', status: 'completed' },
            { text: 'Step two', status: 'inProgress' },
            { text: 'Dropped', status: 'cancelled' },
          ],
        })
      else if (turn === 2)
        run.onEvent?.('session/todoListChanged', {
          items: [
            { text: 'Step one', status: 'completed' },
            { text: 'Step two', status: 'completed' },
          ],
        })
      else run.onEvent?.('session/todoListChanged', { items: [] })
      run.onText('Working')
    },
  })
  const task: Task = {
    id: 'todos',
    title: 'Todos',
    repositoryId: 'repo',
    agentId: '',
    harness: { ...defaultTaskHarness('muse'), permission: 'ask' },
    status: 'draft',
    createdAt: '2026-10-07T00:00:00Z',
    messages: [{ id: 'm1', role: 'user', text: 'Work' }],
    files: [],
    draft: '',
    example: false,
  }
  s.store.update((workspace) => ({ ...workspace, tasks: [task] }))
  await (
    await s.tasks.start(task.id)
  ).done
  expect(s.store.task(task.id).nativeTodos).toEqual([
    { text: 'Step one', status: 'completed' },
    { text: 'Step two', status: 'in-progress' },
  ])
  await (
    await s.tasks.start(task.id)
  ).done
  expect(s.store.task(task.id).nativeTodos).toEqual([
    { text: 'Step one', status: 'completed' },
    { text: 'Step two', status: 'completed' },
  ])
  await (
    await s.tasks.start(task.id)
  ).done
  await waitForRuntime(() => expect(s.store.task(task.id).nativeTodos).toBeUndefined())
})
