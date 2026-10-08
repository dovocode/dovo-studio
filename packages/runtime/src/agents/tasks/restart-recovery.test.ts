import { runtimeIntegration, waitForRuntime as waitForRecovery } from '../../testing/integration'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { join } from 'node:path'
import { startRuntime } from '../../index'
import { createServices } from '../../services'
import { openDatabase } from '../../storage/database'
import { fixture } from '../../testing/fixture'
import { AgentRegistry } from '../configuration/registry'
import type { AgentAdapter, AgentRun } from '../execution/types'
import type { Task } from '@dovo/protocol'
vi.setConfig(runtimeIntegration)
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
  vi.restoreAllMocks()
})
async function seed(enabled: boolean, changes: Partial<Task> = {}, uncertain = false) {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const options = {
    databasePath: join(f.directory, '.git', 'restart.sqlite'),
    ownerToken: 'synthetic-owner-token-for-restart-test',
    port: 0,
  }
  const runtime = await startRuntime(options)
  cleanups.push(runtime.close)
  runtime.services.store.update(() => f.workspace)
  runtime.services.preferences.save({ autoContinueAfterRestart: enabled })
  const task = runtime.services.tasks.create({
    title: 'Interrupted',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Original request',
  })
  runtime.services.store.updateTask(task.id, (task) => ({
    ...task,
    status: 'running',
    queuePaused: false,
    ...changes,
  }))
  if (uncertain)
    runtime.services.store.providerActions.record({
      id: 'unconfirmed',
      taskId: task.id,
      attemptId: changes.activeRunId ?? 'attempt',
      kind: 'steer',
      state: 'dispatched',
    })
  await runtime.close()
  return { options, id: task.id }
}
function adapter(run: AgentAdapter['run']) {
  return vi.spyOn(AgentRegistry.prototype, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run,
  })
}
it.each([false, true])(
  'settles orphan draft and interrupted children before parent restart recovery (automatic=%s)',
  async (enabled) => {
    const f = await fixture()
    cleanups.push(f.cleanup)
    const options = {
      databasePath: join(f.directory, '.git', 'children-restart.sqlite'),
      ownerToken: 'synthetic-owner-token-for-restart-test',
      port: 0,
    }
    const db = openDatabase(options.databasePath)
    const first = createServices(db, options.ownerToken)
    cleanups.push(async () => {
      await first.tasks.dispose()
      if (db.open) db.close()
    })
    first.store.update(() => f.workspace)
    first.preferences.save({ autoContinueAfterRestart: enabled })
    const parent = first.tasks.create({
      title: 'Parent',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: 'Delegate',
    })
    first.store.updateTask(parent.id, (task) => ({
      ...task,
      status: 'running',
      activeRunId: 'retired-parent-attempt',
    }))
    const childIds = (['draft', 'running', 'review'] as const).map((status) => {
      const child = first.tasks.create({
        title: `Child ${status}`,
        repositoryId: 'repo',
        agentId: 'agent',
        objective: 'Inspect',
      })
      first.store.updateTask(child.id, (task) => ({
        ...task,
        status,
        delegation: {
          parentTaskId: parent.id,
          parentRunId: 'retired-parent-attempt',
          key: status,
        },
      }))
      return child.id
    })
    expect(first.store.task(childIds[0]).restartRecovery).toBeUndefined()
    await first.tasks.dispose()
    db.close()
    const run = vi.fn<AgentAdapter['run']>(async (context) => {
      expect(context.taskId).toBe(parent.id)
      expect(runtime.tasks.subagentList(parent.id).map((child) => child.status)).toEqual([
        'cancelled',
        'cancelled',
        'review',
      ])
      context.onText('Continued')
    })
    adapter(run)
    const restartedDb = openDatabase(options.databasePath)
    const runtime = createServices(restartedDb, options.ownerToken)
    cleanups.push(async () => {
      await runtime.tasks.dispose()
      if (restartedDb.open) restartedDb.close()
    })
    runtime.tasks.continueAfterRestart(() => runtime.preferences.get().autoContinueAfterRestart)
    await waitForRecovery(() =>
      expect(runtime.tasks.subagentList(parent.id).map((child) => child.status)).toEqual([
        'cancelled',
        'cancelled',
        'review',
      ]),
    )
    expect(runtime.tasks.subagentList(parent.id).every((child) => !child.running)).toBe(true)
    expect(runtime.store.task(parent.id).subagents?.map((child) => child.status)).toEqual([
      'stopped',
      'stopped',
      'completed',
    ])
    expect(runtime.store.task(childIds[0]).restartRecovery).toBeUndefined()
    await expect(runtime.tasks.start(childIds[0])).rejects.toThrow('parent turn has ended')
    await waitForRecovery(() =>
      expect(runtime.store.task(parent.id).status).toBe(enabled ? 'review' : 'failed'),
    )
    expect(run).toHaveBeenCalledTimes(enabled ? 1 : 0)
  },
)
it('defaults to manual continuation and keeps a recoverable interrupted task', async () => {
  const { options, id } = await seed(false)
  const run = vi.fn<AgentAdapter['run']>(async (context) => {
    context.onText('Done')
  })
  adapter(run)
  const runtime = await startRuntime(options)
  cleanups.push(runtime.close)
  await waitForRecovery(() =>
    expect(runtime.services.store.task(id).restartRecovery?.automatic).toBe(false),
  )
  expect(run).not.toHaveBeenCalled()
  expect(runtime.services.store.task(id).status).toBe('failed')
  await (
    await runtime.services.tasks.start(id)
  ).done
  expect(run).toHaveBeenCalledTimes(1)
  expect(runtime.services.store.task(id).restartRecovery).toBeUndefined()
})
it('resumes the interrupted turn but leaves queued follow-ups paused after restart', async () => {
  const { options, id } = await seed(true, {
    queue: [
      { id: 'next', role: 'user', text: 'Queued follow-up', createdAt: new Date().toISOString() },
    ],
  })
  const prompts: string[] = []
  adapter(async (run) => {
    prompts.push(run.prompt)
    run.onSession('saved-session')
    run.onText('Done')
  })
  const runtime = await startRuntime(options)
  cleanups.push(runtime.close)
  await waitForRecovery(() => expect(runtime.services.store.task(id).status).toBe('review'))
  await waitForRecovery(() => expect(prompts).toHaveLength(1))
  expect(prompts[0]).toContain('Original request')
  expect(prompts[0]).not.toContain('Queued follow-up')
  expect(runtime.services.store.task(id).queue?.map((message) => message.id)).toEqual(['next'])
  expect(runtime.services.store.task(id).queuePaused).toBe(true)
  await (
    await runtime.services.tasks.start(id)
  ).done
  expect(prompts).toHaveLength(2)
  expect(prompts[1]).toContain('Queued follow-up')
  expect(runtime.services.store.task(id).queue).toEqual([])
})
it.each([
  { status: 'running' as const, queuePaused: true },
  { status: 'cancelled' as const, queuePaused: true },
])('does not automatically restart explicitly paused or stopped tasks: %j', async (changes) => {
  const { options, id } = await seed(true, changes)
  const run = vi.fn<AgentAdapter['run']>(async () => {})
  adapter(run)
  const runtime = await startRuntime(options)
  cleanups.push(runtime.close)
  await waitForRecovery(() =>
    expect(runtime.services.store.task(id).restartRecovery?.automatic ?? false).toBe(false),
  )
  expect(run).not.toHaveBeenCalled()
})
it('remembers graceful runtime shutdown separately from a user Stop', async () => {
  const { options, id } = await seed(false, { status: 'draft' })
  let active: AgentRun | undefined
  adapter(async (run) => {
    active = run
    run.onSession('interrupted-provider-session')
    run.onText('Partial result before shutdown')
    await new Promise<void>((_resolve, reject) => {
      if (run.signal.aborted) reject(run.signal.reason)
      else run.signal.addEventListener('abort', () => reject(run.signal.reason), { once: true })
    })
  })
  const first = await startRuntime(options)
  cleanups.push(first.close)
  first.services.preferences.save({ autoContinueAfterRestart: true })
  await first.services.tasks.start(id)
  await waitForRecovery(() => expect(active).toBeDefined())
  await first.close()
  const run = vi.fn<AgentAdapter['run']>(async (context) => context.onText('Continued'))
  vi.spyOn(AgentRegistry.prototype, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run,
  })
  const second = await startRuntime(options)
  cleanups.push(second.close)
  await waitForRecovery(() => expect(second.services.store.task(id).status).toBe('review'))
  expect(run).toHaveBeenCalledTimes(1)
  expect(run.mock.calls[0][0].sessionId).toBe('interrupted-provider-session')
  expect(run.mock.calls[0][0].prompt).toContain('continue only the unfinished work')
  expect(run.mock.calls[0][0].prompt).not.toContain('Original request')
  expect(run.mock.calls[0][0].prompt).not.toContain('Partial result before shutdown')
})
it('leaves a failed automatic continuation paused with a manual recovery action', async () => {
  const { options, id } = await seed(true)
  adapter(async () => {
    throw new Error('Provider unavailable')
  })
  const runtime = await startRuntime(options)
  cleanups.push(runtime.close)
  await waitForRecovery(() =>
    expect(runtime.services.store.task(id).error).toContain('Could not continue after restart'),
  )
  expect(runtime.services.store.task(id).restartRecovery?.automatic).toBe(false)
  expect(runtime.services.store.task(id).queuePaused).toBe(true)
})

it('keeps a queued-only task paused despite auto-continue and persists the runtime preference', async () => {
  const { options, id } = await seed(false, {
    status: 'review',
    queuePaused: false,
    queue: [
      {
        id: 'queued-only',
        role: 'user',
        text: 'Next request',
        createdAt: new Date().toISOString(),
      },
    ],
  })
  // Save via the public boundary before restart; no account/login is involved.
  const first = await startRuntime(options)
  cleanups.push(first.close)
  const address = `http://127.0.0.1:${first.port}`
  const headers = {
    Authorization: `Bearer ${options.ownerToken}`,
    'Content-Type': 'application/json',
  }
  expect(
    (
      await fetch(address + '/api/runtime/preferences/read', {
        method: 'POST',
        headers,
        body: '{}',
      }).then((response) => response.json())
    ).autoContinueAfterRestart,
  ).toBe(false)
  const result = await fetch(address + '/api/runtime/preferences/save', {
    method: 'POST',
    headers,
    body: JSON.stringify({ autoContinueAfterRestart: true }),
  })
  expect(result.status).toBe(200)
  expect(
    (
      await fetch(address + '/api/runtime/preferences/save', {
        method: 'POST',
        headers,
        body: JSON.stringify({ autoContinueAfterRestart: 'yes' }),
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await fetch(address + '/api/runtime/preferences/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
  ).toBe(401)
  first.services.store.updateTask(id, (task) => ({
    ...task,
    queuePaused: false,
    restartRecovery: undefined,
  }))
  await first.close()
  const prompts: string[] = []
  adapter(async (run) => {
    prompts.push(run.prompt)
    run.onText('Done')
  })
  const second = await startRuntime(options)
  cleanups.push(second.close)
  expect(second.services.store.task(id).queue?.map((message) => message.id)).toEqual([
    'queued-only',
  ])
  expect(second.services.store.task(id).queuePaused).toBe(true)
  expect(prompts).toHaveLength(0)
  await (
    await second.services.tasks.start(id)
  ).done
  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toContain('Next request')
})

it('continues issue/PR tasks with source URLs instead of treating origin as automation ownership', async () => {
  const { options, id } = await seed(true, { origin: 'https://example.invalid/issues/123' })
  const run = vi.fn<AgentAdapter['run']>(async (context) => context.onText('Continued'))
  adapter(run)
  const runtime = await startRuntime(options)
  cleanups.push(runtime.close)
  await waitForRecovery(() => expect(runtime.services.store.task(id).status).toBe('review'))
  expect(run).toHaveBeenCalledTimes(1)
})
it('excludes tasks owned by the automation supervisor', async () => {
  const { options, id } = await seed(false)
  const run = vi.fn<AgentAdapter['run']>(async () => {})
  adapter(run)
  const runtime = await startRuntime(options)
  cleanups.push(runtime.close)
  await waitForRecovery(() =>
    expect(runtime.services.store.task(id).restartRecovery?.automatic).toBe(false),
  )
  runtime.services.store.updateTask(id, (task) => ({
    ...task,
    restartRecovery: { kind: 'turn', automatic: true },
  }))
  runtime.services.tasks.continueAfterRestart(
    () => true,
    (taskId) => taskId === id,
  )
  await waitForRecovery(() =>
    expect(runtime.services.store.task(id).restartRecovery?.automatic).toBe(false),
  )
  expect(run).not.toHaveBeenCalled()
})

it('clears queue-only recovery when the last queued message is removed', async () => {
  const { options, id } = await seed(false, {
    status: 'review',
    queuePaused: false,
    queue: [
      { id: 'last', role: 'user', text: 'Do this later', createdAt: new Date().toISOString() },
    ],
  })
  const run = vi.fn<AgentAdapter['run']>(async () => {})
  adapter(run)
  const runtime = await startRuntime(options)
  cleanups.push(runtime.close)
  expect(runtime.services.store.task(id).restartRecovery?.kind).toBe('queue')
  runtime.services.tasks.queue.change(id, 'remove', 'last')
  expect(runtime.services.store.task(id).restartRecovery).toBeUndefined()
  expect(runtime.services.store.task(id).queue).toEqual([])
  expect(run).not.toHaveBeenCalled()
})

it('does not replay the objective when recovery input is removed during checkout preparation', async () => {
  const { options, id } = await seed(false, {
    status: 'review',
    queuePaused: false,
    queue: [{ id: 'last', role: 'user', text: 'Queued only', createdAt: new Date().toISOString() }],
  })
  const run = vi.fn<AgentAdapter['run']>(async () => {})
  adapter(run)
  const runtime = await startRuntime(options)
  cleanups.push(runtime.close)
  const cwd = runtime.services.store.get().repositories[0].path
  let release = () => {}
  const gate = new Promise<string>((resolve) => {
    release = () => resolve(cwd)
  })
  vi.spyOn(runtime.services.checkouts, 'directory').mockReturnValue(gate)
  const starting = runtime.services.tasks.start(id)
  await waitForRecovery(() => expect(runtime.services.store.task(id).status).toBe('running'))
  runtime.services.tasks.queue.change(id, 'remove', 'last')
  release()
  await (
    await starting
  ).done
  expect(run).not.toHaveBeenCalled()
  expect(runtime.services.store.task(id).status).toBe('review')
})

it('atomically blocks new task admission while the owner prepares a restart', async () => {
  const { options, id } = await seed(false, { status: 'draft' })
  const runtime = await startRuntime(options)
  cleanups.push(runtime.close)
  const request = (path: string, input = {}) =>
    fetch(`http://127.0.0.1:${runtime.port}` + path, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.ownerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    })
  const response = await request('/api/runtime/prepare-restart')
  expect(response.status).toBe(200)
  const lease: unknown = await response.json()
  await expect(runtime.services.tasks.start(id)).rejects.toThrow('restarting')
  expect((await request('/api/runtime/prepare-restart')).status).toBe(409)
  expect(
    (
      await fetch(`http://127.0.0.1:${runtime.port}/api/runtime/cancel-restart`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.ownerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(lease),
      })
    ).status,
  ).toBe(200)
  adapter(async () => {})
  await (
    await runtime.services.tasks.start(id)
  ).done
})

it('keeps an initial queued request after a crash until resumed, without a phantom continuation', async () => {
  const { options, id } = await seed(true, {
    runPhase: 'preparing',
    messages: [],
    queue: [{ id: 'initial', role: 'user', text: 'The actual request', createdAt: '' }],
  })
  const run = vi.fn<AgentAdapter['run']>(async (context) => context.onText('Done'))
  adapter(run)
  const runtime = await startRuntime(options)
  cleanups.push(runtime.close)
  expect(runtime.services.store.task(id).queue?.map((message) => message.id)).toEqual(['initial'])
  expect(runtime.services.store.task(id).queuePaused).toBe(true)
  expect(run).not.toHaveBeenCalled()
  await (
    await runtime.services.tasks.start(id)
  ).done
  expect(run).toHaveBeenCalledTimes(1)
  expect(run.mock.calls[0][0].prompt).toContain('The actual request')
  expect(run.mock.calls[0][0].prompt).not.toContain('runtime restarted')
  expect(runtime.services.store.task(id).queue).toEqual([])
})

it.each([false, true])(
  'only consumes an interrupted prompt after acceptance evidence (accepted=%s)',
  async (accepted) => {
    const f = await fixture()
    cleanups.push(f.cleanup)
    const options = {
      databasePath: join(f.directory, '.git', 'acceptance.sqlite'),
      ownerToken: 'synthetic-owner-token-for-restart-test',
      port: 0,
    }
    const runtime = await startRuntime(options)
    runtime.services.store.update(() => f.workspace)
    runtime.services.preferences.save({ autoContinueAfterRestart: true })
    const task = runtime.services.tasks.create({
      title: 'Prompt boundary',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: 'Do not lose this original request',
    })
    let allocated = false
    const lookup = adapter(async (context) => {
      context.onSession('allocated-session')
      if (accepted) context.onPromptAccepted?.()
      allocated = true
      await new Promise<void>((resolve) =>
        context.signal.addEventListener('abort', () => resolve(), { once: true }),
      )
      context.signal.throwIfAborted()
    })
    await runtime.services.tasks.start(task.id)
    await waitForRecovery(() => expect(allocated).toBe(true))
    expect(runtime.services.store.task(task.id).runAttempt?.promptAccepted).toBe(accepted)
    await runtime.close()
    const run = vi.fn<AgentAdapter['run']>(async (context) => context.onText('Recovered'))
    lookup.mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run,
    })
    const restarted = await startRuntime(options)
    cleanups.push(restarted.close)
    await waitForRecovery(() =>
      expect(restarted.services.store.task(task.id).status).toBe('review'),
    )
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][0].sessionId).toBe('allocated-session')
    expect(run.mock.calls[0][0].prompt.includes('Do not lose this original request')).toBe(
      !accepted,
    )
  },
)

it('holds an unconfirmed provider action for manual review even when automatic recovery is enabled', async () => {
  const { options, id } = await seed(
    true,
    { activeRunId: 'attempt', runAttempt: { inputMessageIds: [], promptAccepted: true } },
    true,
  )
  const run = vi.fn<AgentAdapter['run']>(async () => {})
  adapter(run)
  const runtime = await startRuntime(options)
  cleanups.push(runtime.close)
  await waitForRecovery(() =>
    expect(runtime.services.store.task(id).restartRecovery?.automatic).toBe(false),
  )
  expect(run).not.toHaveBeenCalled()
  expect(runtime.services.store.providerActions.list(id)[0]?.state).toBe('uncertain')
  expect(runtime.services.store.task(id).error).toContain('not confirmed')
  expect(runtime.services.store.task(id).activeRunId).toBeUndefined()
})

it('recovers a durable child completion exactly once and holds it for manual continuation', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const options = {
    databasePath: join(f.directory, '.git', 'completion.sqlite'),
    ownerToken: 'synthetic-owner-token-for-restart-test',
    port: 0,
  }
  const first = await startRuntime(options)
  first.services.store.update(() => f.workspace)
  const parent = first.services.tasks.create({
    title: 'Parent',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Work',
  })
  first.services.store.updateTask(parent.id, (task) => ({ ...task, status: 'review' }))
  const child = first.services.tasks.create({
    title: 'Child',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Inspect',
  })
  first.services.store.updateTask(child.id, (task) => ({
    ...task,
    status: 'review',
    messages: [
      ...task.messages,
      { id: 'answer', role: 'assistant', text: 'Recovered child answer' },
    ],
    delegation: {
      parentTaskId: parent.id,
      parentRunId: 'finished-run',
      key: 'child',
      completion: 'pending',
    },
  }))
  await first.close()
  const run = vi.fn<AgentAdapter['run']>(async (context) => context.onText('Handled result'))
  adapter(run)
  const second = await startRuntime(options)
  cleanups.push(second.close)
  expect(second.services.store.task(parent.id).queue?.[0]?.text).toContain('Recovered child answer')
  expect(second.services.store.task(parent.id).queuePaused).toBe(true)
  expect(run).not.toHaveBeenCalled()
  expect(second.services.store.task(child.id).delegation?.completion).toBe('queued')
  await second.close()
  const third = await startRuntime(options)
  cleanups.push(third.close)
  expect(third.services.store.task(parent.id).queue).toHaveLength(1)
  expect(run).not.toHaveBeenCalled()
  await (
    await third.services.tasks.start(parent.id)
  ).done
  expect(run).toHaveBeenCalledOnce()
  expect(run.mock.calls[0][0].prompt).toContain('Recovered child answer')
  expect(third.services.store.task(parent.id).queue).toEqual([])
})

it('retains interruption delivery when the runtime shuts down with an idle parent and a working child', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const options = {
    databasePath: join(f.directory, '.git', 'working-child.sqlite'),
    ownerToken: 'synthetic-owner-token-for-restart-test',
    port: 0,
  }
  let childId = ''
  const lookup = adapter(async (run) => {
    if (run.agent.provider === 'claude') {
      await new Promise<void>((resolve) =>
        run.signal.addEventListener('abort', () => resolve(), { once: true }),
      )
      run.signal.throwIfAborted()
    } else {
      if (!run.taskId) throw new Error('Expected a task')
      childId = first.services.tasks.subagentSpawn({
        taskId: run.taskId,
        key: 'shutdown',
        name: 'Inspect',
        prompt: 'Inspect',
        provider: 'claude',
      }).id
      run.onText('Parent reply')
    }
  })
  const first = await startRuntime(options)
  cleanups.push(first.close)
  first.services.store.update(() => f.workspace)
  const parent = first.services.tasks.create({
    title: 'Parent',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Work',
  })
  await (
    await first.services.tasks.start(parent.id)
  ).done
  await waitForRecovery(() => expect(first.services.store.task(childId).status).toBe('running'))
  await first.close()
  const resumed = vi.fn<AgentAdapter['run']>(async (run) => run.onText('Handled interruption'))
  lookup.mockResolvedValue({ probe: vi.fn<AgentAdapter['probe']>(), run: resumed })
  const restarted = await startRuntime(options)
  cleanups.push(restarted.close)
  const task = restarted.services.store.task(parent.id)
  expect(task.status).toBe('review')
  expect(task.queuePaused).toBe(true)
  expect(task.queue?.[0]?.text).toContain('Child interrupted by runtime restart')
  expect(restarted.services.store.task(childId).delegation?.completion).toBe('queued')
  expect(resumed).not.toHaveBeenCalled()
  await (
    await restarted.services.tasks.start(parent.id)
  ).done
  expect(resumed).toHaveBeenCalledOnce()
  expect(resumed.mock.calls[0][0].prompt).toContain('Child interrupted by runtime restart')
})
