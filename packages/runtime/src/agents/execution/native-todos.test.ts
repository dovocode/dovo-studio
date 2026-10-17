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

it.each(['muse', 'codex', 'claude', 'opencode', 'acp', 'grok', 'vibe'] as const)(
  'stores the latest %s checklist across turns and clears it explicitly',
  async (provider) => {
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
        run.onSession('root-session')
        const publish = (items: Array<{ text: string; status: string }>) => {
          if (provider === 'muse') run.onEvent?.('session/todoListChanged', { items })
          else if (provider === 'codex') {
            run.onEvent?.('turn/plan/updated', {
              threadId: 'root-session',
              plan: items.map((item) => ({ step: item.text, status: item.status })),
            })
            run.onEvent?.('turn/plan/updated', { threadId: 'child-session', plan: [] })
          } else if (provider === 'opencode') {
            const properties = {
              sessionID: 'root-session',
              todos: items.map((item) => ({ content: item.text, status: item.status })),
            }
            run.onEvent?.('todo.updated', { properties })
            run.onEvent?.('todo.updated', { properties: { sessionID: 'child-session', todos: [] } })
          } else if (provider === 'acp' || provider === 'grok') {
            run.onEvent?.('plan', {
              sessionId: 'root-session',
              update: {
                sessionUpdate: 'plan',
                entries: items.map((item) => ({
                  content: item.text,
                  status: item.status,
                  priority: 'medium',
                })),
              },
            })
            run.onEvent?.('plan', {
              sessionId: 'child-session',
              update: { sessionUpdate: 'plan', entries: [] },
            })
          } else if (provider === 'vibe') {
            const entry = {
              sessionId: 'root-session',
              type: 'effect',
              detail: { kind: 'todo' },
              state: {
                status: 'completed',
                output: {
                  todos: items.map((item) => ({ content: item.text, status: item.status })),
                },
              },
            }
            run.onEvent?.('vibe/effect', { entry })
            run.onEvent?.('vibe/effect', {
              entry: {
                ...entry,
                sessionId: 'child-session',
                state: { status: 'completed', output: { todos: [] } },
              },
            })
          } else {
            run.onEvent?.('claude/checklist', {
              tool_name: 'TodoWrite',
              tool_response: {
                newTodos: items.map((item) => ({ content: item.text, status: item.status })),
              },
            })
            run.onEvent?.('claude/checklist', {
              agent_id: 'child',
              tool_name: 'TodoWrite',
              tool_response: { newTodos: [] },
            })
          }
        }
        turn += 1
        if (turn === 1)
          publish([
            { text: 'Step one', status: 'completed' },
            { text: 'Step two', status: 'inProgress' },
            { text: 'Dropped', status: 'cancelled' },
          ])
        else if (turn === 2)
          publish([
            { text: 'Step one', status: 'completed' },
            { text: 'Step two', status: 'completed' },
          ])
        else publish([])
        run.onText('Working')
      },
    })
    const task: Task = {
      id: 'todos',
      title: 'Todos',
      repositoryId: 'repo',
      agentId: '',
      harness: { ...defaultTaskHarness(provider), permission: 'ask' },
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
  },
)
