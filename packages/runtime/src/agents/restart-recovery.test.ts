import { afterEach, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { startRuntime } from '../index'
import { fixture } from '../testing/fixture'
import { AgentRegistry } from './registry'
import type { AgentAdapter, AgentRun } from './types'
import type { Task } from '@dovo/protocol'
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
  vi.restoreAllMocks()
})
async function seed(enabled: boolean, changes: Partial<Task> = {}) {
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
  await runtime.close()
  return { options, id: task.id }
}
function adapter(run: AgentAdapter['run']) {
  return vi.spyOn(AgentRegistry.prototype, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run,
  })
}
it('defaults to manual continuation and keeps a recoverable interrupted task', async () => {
  const { options, id } = await seed(false)
  const run = vi.fn<AgentAdapter['run']>(async (context) => {
    context.onText('Done')
  })
  adapter(run)
  const runtime = await startRuntime(options)
  cleanups.push(runtime.close)
  await vi.waitFor(() =>
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
it('resumes the interrupted turn before consuming queued follow-ups', async () => {
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
  await vi.waitFor(() => expect(runtime.services.store.task(id).status).toBe('review'))
  await vi.waitFor(() => expect(prompts).toHaveLength(2))
  await vi.waitFor(() => expect(runtime.services.store.task(id).queue).toEqual([]))
  expect(prompts[0]).toContain('Original request')
  expect(prompts[0]).not.toContain('Queued follow-up')
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
  await vi.waitFor(() =>
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
  await vi.waitFor(() => expect(active).toBeDefined())
  await first.close()
  const run = vi.fn<AgentAdapter['run']>(async (context) => context.onText('Continued'))
  vi.spyOn(AgentRegistry.prototype, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run,
  })
  const second = await startRuntime(options)
  cleanups.push(second.close)
  await vi.waitFor(() => expect(second.services.store.task(id).status).toBe('review'))
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
  await vi.waitFor(() =>
    expect(runtime.services.store.task(id).error).toContain('Could not continue after restart'),
  )
  expect(runtime.services.store.task(id).restartRecovery?.automatic).toBe(false)
  expect(runtime.services.store.task(id).queuePaused).toBe(true)
})

it('continues an unpaused queue and persists the runtime preference through the authenticated API', async () => {
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
  await vi.waitFor(() => expect(second.services.store.task(id).queue).toEqual([]))
  await vi.waitFor(() => expect(second.services.store.task(id).status).toBe('review'))
  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toContain('Next request')
})

it('continues issue/PR tasks with source URLs instead of treating origin as automation ownership', async () => {
  const { options, id } = await seed(true, { origin: 'https://example.invalid/issues/123' })
  const run = vi.fn<AgentAdapter['run']>(async (context) => context.onText('Continued'))
  adapter(run)
  const runtime = await startRuntime(options)
  cleanups.push(runtime.close)
  await vi.waitFor(() => expect(runtime.services.store.task(id).status).toBe('review'))
  expect(run).toHaveBeenCalledTimes(1)
})
it('excludes tasks owned by the automation supervisor', async () => {
  const { options, id } = await seed(false)
  const run = vi.fn<AgentAdapter['run']>(async () => {})
  adapter(run)
  const runtime = await startRuntime(options)
  cleanups.push(runtime.close)
  await vi.waitFor(() =>
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
  await vi.waitFor(() =>
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
  await vi.waitFor(() => expect(runtime.services.store.task(id).status).toBe('running'))
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

it('dequeues an initial request after a crash before admission, without a phantom continuation', async () => {
  const { options, id } = await seed(true, {
    runPhase: 'preparing',
    messages: [],
    queue: [{ id: 'initial', role: 'user', text: 'The actual request', createdAt: '' }],
  })
  const run = vi.fn<AgentAdapter['run']>(async (context) => context.onText('Done'))
  adapter(run)
  const runtime = await startRuntime(options)
  cleanups.push(runtime.close)
  await vi.waitFor(() => expect(runtime.services.store.task(id).status).toBe('review'))
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
    await vi.waitFor(() => expect(allocated).toBe(true))
    expect(runtime.services.store.task(task.id).runAttempt?.promptAccepted).toBe(accepted)
    await runtime.close()
    const run = vi.fn<AgentAdapter['run']>(async (context) => context.onText('Recovered'))
    lookup.mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run,
    })
    const restarted = await startRuntime(options)
    cleanups.push(restarted.close)
    await vi.waitFor(() => expect(restarted.services.store.task(task.id).status).toBe('review'))
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][0].sessionId).toBe('allocated-session')
    expect(run.mock.calls[0][0].prompt.includes('Do not lose this original request')).toBe(
      !accepted,
    )
  },
)
