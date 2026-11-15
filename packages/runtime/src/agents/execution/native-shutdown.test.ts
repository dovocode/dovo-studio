import { afterEach, expect, it, vi } from 'vite-plus/test'
import { defaultTaskHarness, taskFamilyRunToken, recentTools } from '@dovo/protocol'
import { startRuntime } from '../../index'
import { fixture } from '../../testing/fixture'
import { runtimeIntegration } from '../../testing/integration'
import type { AgentAdapter, AgentRun } from './types'
vi.setConfig(runtimeIntegration)
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

it('settles native work after a late provider exit while an independent child keeps running', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'provider-exit-test-token-at-least-32-characters',
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.store.update(() => f.workspace)
  let owner: AgentRun | undefined
  let childId = ''
  let markChildStarted = () => {}
  const childStarted = new Promise<void>((resolve) => {
    markChildStarted = resolve
  })
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      if (run.agent.provider === 'codex') {
        markChildStarted()
        await new Promise<void>((resolve) =>
          run.signal.addEventListener('abort', () => resolve(), { once: true }),
        )
        return
      }
      owner = run
      run.onSession('native-session')
      run.onNativeSession?.(
        { stop: async () => run.onSubagentEvent?.('dovo/session/closed', {}, 'native-session') },
        'native-session',
      )
      run.onEvent?.('assistant', {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'pending-tool', name: 'Read', input: { file_path: '/source' } },
          ],
        },
      })
      run.onSubagentEvent?.(
        'system',
        {
          type: 'system',
          subtype: 'task_started',
          task_type: 'local_agent',
          task_id: 'native-child',
        },
        'native-session',
      )
      if (!run.taskId) throw new Error('Missing parent task')
      childId = s.tasks.subagentSpawn({
        taskId: run.taskId,
        key: 'independent',
        name: 'Independent',
        prompt: 'Keep working',
        provider: 'codex',
      }).id
      await childStarted
      run.onText('Parent complete')
    },
  })
  const parent = s.tasks.create({
    title: 'Parent',
    repositoryId: 'repo',
    agentId: '',
    objective: 'Work',
    harness: defaultTaskHarness('claude'),
  })
  await (
    await s.tasks.start(parent.id)
  ).done
  s.store.updateTask(parent.id, (task) => ({ ...task, queuePaused: true }))
  const tools = () => recentTools(s.activity.list('', 'tool', 0, parent.id).events)
  expect(tools()[0].status).toBe('running')
  owner?.onSubagentEvent?.('dovo/session/closed', {}, 'unrelated-session')
  expect(tools()[0].status).toBe('running')
  owner?.onSubagentEvent?.('dovo/session/closed', {}, 'native-session')
  expect(tools()[0].status).toBe('interrupted')
  expect(
    s.store.taskSummary(parent.id).subagents?.find((agent) => agent.id === 'native-child'),
  ).toMatchObject({ status: 'stopped', sessionLive: false })
  expect(s.store.taskSummary(childId).status).toBe('running')
  // An event already queued when the process died must not restore a running card.
  owner?.onEvent?.('assistant', {
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: 'pending-tool', name: 'Read', input: {} }] },
  })
  expect(tools()[0].status).toBe('interrupted')
  s.tasks.cancel(childId)
})

it.each(['rejected', 'missing', 'hanging', 'persistence failure'] as const)(
  'retains checkout ownership after %s native shutdown and releases it on authoritative closure',
  async (mode) => {
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
    let owner: AgentRun | undefined
    const stop = vi
      .fn<(id?: string) => Promise<void>>()
      .mockRejectedValue(new Error('provider stop rejected'))
    vi.spyOn(s.agents, 'get').mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run: async (run) => {
        owner = run
        run.onSession('native-session')
        run.onSubagentEvent?.(
          'system',
          { type: 'system', subtype: 'task_started', task_type: 'local_agent', task_id: 'child' },
          'native-session',
        )
        if (mode !== 'missing') run.onNativeSession?.({ stop }, 'native-session')
        await new Promise<void>((resolve) => {
          if (run.signal.aborted) resolve()
          else run.signal.addEventListener('abort', () => resolve(), { once: true })
        })
      },
    })
    const task = s.tasks.create({
      title: 'Parent',
      repositoryId: 'repo',
      agentId: '',
      objective: 'Work',
      harness: defaultTaskHarness('claude'),
    })
    const run = await s.tasks.start(task.id)
    await vi.waitFor(() => expect(owner).toBeDefined())
    if (mode === 'hanging') {
      stop.mockImplementation(() => new Promise<void>(() => {}))
      const schedule = globalThis.setTimeout
      vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay, ...args) =>
        schedule(callback, delay === 30000 ? 10 : delay, ...args),
      )
    }
    const done = run.done.catch(() => undefined)
    const persistence =
      mode === 'persistence failure'
        ? vi.spyOn(s.store, 'updateTask').mockImplementation(() => {
            throw new Error('disk full')
          })
        : undefined
    if (persistence) vi.spyOn(console, 'error').mockImplementation(() => {})
    let cancellationError: unknown
    try {
      s.tasks.cancel(task.id)
    } catch (error) {
      cancellationError = error
    }
    const expectedFailure = expect.objectContaining({
      message: expect.stringContaining('Could not persist'),
    })
    expect(cancellationError).toEqual(persistence ? expectedFailure : undefined)
    await done
    persistence?.mockRestore()
    vi.useRealTimers()
    expect(stop.mock.calls.length > 0).toBe(mode !== 'missing')
    expect(s.store.taskSummary(task.id)).toMatchObject(
      persistence ? { id: task.id } : { status: 'cancelled', queuePaused: true },
    )
    await expect(s.tasks.withCheckoutMutation(f.directory, async () => {})).rejects.toThrow(
      'running agent',
    )
    expect(() => s.tasks.requireIdle(task.id)).toThrow('Stop the active turn')
    owner?.onSubagentEvent?.('dovo/session/closed', {}, 'native-session')
    await vi.waitFor(() => expect(() => s.tasks.requireIdle(task.id)).not.toThrow())
    await s.tasks.withCheckoutMutation(f.directory, async () => {})
  },
)

it('blocks a new family turn after native Stop fails without a held provider run', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'native-stop-admission-token-at-least-32-characters',
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.store.update(() => f.workspace)
  let owner: AgentRun | undefined
  let turns = 0
  const stop = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('native still alive'))
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      owner = run
      turns++
      run.onSession('native-session')
      run.onNativeSession?.({ stop }, 'native-session')
      run.onSubagentEvent?.(
        'system',
        { type: 'system', subtype: 'task_started', task_type: 'local_agent', task_id: 'child' },
        'native-session',
      )
      run.onText('Parent complete; native child continues')
    },
  })
  const task = s.tasks.create({
    title: 'Parent',
    repositoryId: 'repo',
    agentId: '',
    objective: 'Work',
    harness: defaultTaskHarness('claude'),
  })
  try {
    await (
      await s.tasks.start(task.id)
    ).done
    // Normal native family concurrency stays available after the provider run has settled.
    await (
      await s.tasks.start(task.id)
    ).done
    expect(turns).toBe(2)
    await expect(
      s.tasks.stopAgents(task.id, taskFamilyRunToken(s.store.get().tasks, task.id)),
    ).rejects.toThrow('shutdown was not confirmed')
    await vi.waitFor(() =>
      expect(s.store.taskSummary(task.id).error).toContain('shutdown was not confirmed'),
    )
    await expect(s.tasks.start(task.id)).rejects.toMatchObject({ status: 409 })
    expect(turns).toBe(2)
    owner?.onSubagentEvent?.('dovo/session/closed', {}, 'native-session')
    await vi.waitFor(() => expect(() => s.tasks.requireIdle(task.id)).not.toThrow())
  } finally {
    owner?.onSubagentEvent?.('dovo/session/closed', {}, 'native-session')
  }
})
