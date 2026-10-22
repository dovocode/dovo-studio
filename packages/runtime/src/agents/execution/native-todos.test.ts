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
  'keeps live %s progress and carries only unfinished checklist items across turns',
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
    let liveTodos: Task['nativeTodos']
    const starts: Array<{ sessionId?: string; prompt: string; todos: Task['nativeTodos'] }> = []
    vi.spyOn(s.agents, 'get').mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run: async (run) => {
        starts.push({
          sessionId: run.sessionId,
          prompt: run.prompt,
          todos: s.store.task('todos').nativeTodos,
        })
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
        if (turn === 1) {
          publish([
            { text: 'Step one', status: 'completed' },
            { text: 'Step two', status: 'inProgress' },
            { text: 'Step three', status: 'pending' },
            { text: 'Dropped', status: 'cancelled' },
          ])
          liveTodos = s.store.taskSummary('todos').nativeTodos
        } else if (turn === 2)
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
    expect(liveTodos).toEqual([
      { text: 'Step one', status: 'completed' },
      { text: 'Step two', status: 'in-progress' },
      { text: 'Step three', status: 'pending' },
    ])
    expect(s.store.task(task.id).nativeTodos).toEqual([
      { text: 'Step two', status: 'in-progress' },
      { text: 'Step three', status: 'pending' },
    ])
    // Replacing a provider session must not silently erase the thread's unfinished work.
    s.store.updateTask(task.id, (current) => ({
      ...current,
      sessionId: undefined,
      sessionAgentId: undefined,
    }))
    await (
      await s.tasks.start(task.id)
    ).done
    expect(starts[1]?.sessionId).toBeUndefined()
    expect(starts[1]?.prompt).toContain('Saved shared checklist')
    expect(starts[1]?.prompt).toContain('Step two')
    expect(starts[1]?.prompt).not.toContain('Step one')
    expect(starts[1]?.todos).toEqual([
      { text: 'Step two', status: 'in-progress' },
      { text: 'Step three', status: 'pending' },
    ])
    expect(s.store.task(task.id).nativeTodos).toBeUndefined()
    await (
      await s.tasks.start(task.id)
    ).done
    await waitForRuntime(() => expect(s.store.task(task.id).nativeTodos).toBeUndefined())
  },
)

it.each(['failed', 'cancelled', 'queued'] as const)(
  'prunes completed items after a %s turn without losing pending work or follow-ups',
  async (outcome) => {
    const f = await fixture()
    cleanups.push(f.cleanup)
    const runtime = await startRuntime({
      databasePath: ':memory:',
      ownerToken: 'checklist-cleanup-owner-token-at-least-32-characters',
      port: 0,
    })
    cleanups.push(() => runtime.close())
    const s = runtime.services
    s.store.update(() => f.workspace)
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    cleanups.push(async () => release())
    const remaining = [
      { id: 'active', text: 'Still working', status: 'in-progress' },
      { id: 'later', text: 'Not started', status: 'pending' },
    ] satisfies NonNullable<Task['nativeTodos']>
    let runs = 0
    const following: Array<{ todos: Task['nativeTodos']; prompt: string }> = []
    vi.spyOn(s.agents, 'get').mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run: async (run) => {
        runs += 1
        if (runs === 1) {
          // This is also the state written by the regular MCP checklist tool.
          s.store.updateTask(task.id, (current) => ({
            ...current,
            nativeTodos: [{ id: 'done', text: 'Finished', status: 'completed' }, ...remaining],
          }))
          await gate
          if (outcome === 'failed') throw new Error('Provider failed')
        } else {
          following.push({ todos: s.store.taskSummary(task.id).nativeTodos, prompt: run.prompt })
        }
        run.onText('Reply')
      },
    })
    const task = s.tasks.create({
      title: 'Cleanup',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: 'Work',
    })
    const execution = await s.tasks.start(task.id)
    await waitForRuntime(() => expect(s.store.taskSummary(task.id).nativeTodos).toHaveLength(3))
    if (outcome === 'queued') await s.tasks.send(task.id, 'follow-up', 'Keep this follow-up')
    if (outcome === 'cancelled') s.tasks.cancel(task.id)
    release()
    const [result] = await Promise.allSettled([execution.done])
    expect(result.status).toBe(outcome === 'queued' ? 'fulfilled' : 'rejected')
    expect(following.map((run) => run.todos)).toEqual(outcome === 'queued' ? [remaining] : [])
    expect(following.map((run) => run.prompt).join('\n')).not.toContain('"text":"Finished"')
    expect(s.store.taskSummary(task.id).nativeTodos).toEqual(remaining)
    expect(s.store.taskSummary(task.id).status).toBe(outcome === 'queued' ? 'review' : outcome)
    expect(runs).toBe(outcome === 'queued' ? 2 : 1)
    expect(
      s.store.task(task.id).messages.some((message) => message.text === 'Keep this follow-up'),
    ).toBe(outcome === 'queued')
  },
)
