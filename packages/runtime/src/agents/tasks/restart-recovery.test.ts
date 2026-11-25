import { runtimeIntegration, waitForRuntime as waitForRecovery } from '../../testing/integration'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { chromium } from 'playwright'
import { startRuntime } from '../../index'
import { createServices } from '../../services'
import { openDatabase } from '../../storage/database'
import { fixture } from '../../testing/fixture'
import { AgentRegistry } from '../configuration/registry'
import type { AgentAdapter, AgentRun } from '../execution/types'
import type { Task } from '@dovo/protocol'
import { defaultTaskHarness } from '@dovo/protocol'
vi.setConfig(runtimeIntegration)
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
  vi.restoreAllMocks()
})
async function seed(
  enabled: boolean,
  changes: Partial<Task> = {},
  uncertain = false,
  projectOverride?: boolean,
) {
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
  if (projectOverride !== undefined)
    runtime.services.store.update((workspace) => ({
      ...workspace,
      repositories: workspace.repositories.map((repository) => ({
        ...repository,
        taskBehavior: { continueAfterRestart: projectOverride },
      })),
    }))
  const task = runtime.services.tasks.create({
    title: 'Interrupted',
    repositoryId: 'repo',
    agentId: changes.agentId ?? 'agent',
    harness: changes.harness,
    objective: 'Original request',
  })
  runtime.services.store.updateTaskHistory(task.id, (task) => ({
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
it.each([true, false])(
  'waits for external OpenCode work after restart (recorded child=%s)',
  async (child) => {
    const now = new Date().toISOString()
    const { options, id } = await seed(true, {
      agentId: '',
      harness: { ...defaultTaskHarness('opencode'), endpoint: 'http://open-code.test:4096' },
      activeRunId: 'old-attempt',
      runPhase: 'provider',
      sessionId: 'server-session',
      ...(child
        ? {
            subagents: [
              {
                id: 'child',
                provider: 'opencode',
                name: 'Remote child',
                status: 'working',
                sessionId: 'server-session',
                sessionLive: true,
                startedAt: now,
                updatedAt: now,
              },
            ],
          }
        : {}),
    })
    let idle = false
    const restore = vi
      .fn<NonNullable<AgentAdapter['recoveredSessionIdle']>>()
      .mockRejectedValueOnce(new Error('Server unavailable'))
      .mockImplementation(async () => idle)
    const run = vi.fn<AgentAdapter['run']>(async (context) => context.onText('Continued safely'))
    adapter(run).mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run,
      recoveredSessionIdle: restore,
    })
    const runtime = await startRuntime(options)
    cleanups.push(runtime.close)
    const { store, tasks } = runtime.services
    await waitForRecovery(() => expect(restore).toHaveBeenCalledTimes(2))
    expect(restore).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'opencode' }),
      'server-session',
      [child ? 'child' : 'server-session'],
      expect.any(String),
      expect.any(AbortSignal),
    )
    expect(store.task(id).subagents).toMatchObject([{ sessionLive: true, status: 'unknown' }])
    expect(run).not.toHaveBeenCalled()
    const peer = tasks.create({
      title: 'Peer',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: 'Work',
    })
    await expect(tasks.start(peer.id)).rejects.toThrow('shutdown has not been confirmed')
    idle = true
    await waitForRecovery(() => expect(store.task(id).status).toBe('review'))
    expect(store.task(id).subagents).toMatchObject([{ sessionLive: false, status: 'unknown' }])
    expect(run).toHaveBeenCalledOnce()
  },
)
it.each([false, true])(
  'honors project restart override %s over the opposite global preference',
  async (project) => {
    const { options, id } = await seed(!project, {}, false, project)
    const run = vi.fn<AgentAdapter['run']>(async (context) => context.onText('Continued'))
    adapter(run)
    const runtime = await startRuntime(options)
    cleanups.push(runtime.close)
    await waitForRecovery(() => {
      const task = runtime.services.store.task(id)
      expect({ status: task.status, automatic: task.restartRecovery?.automatic }).toEqual(
        project
          ? { status: 'review', automatic: undefined }
          : { status: 'failed', automatic: false },
      )
    })
    expect(run).toHaveBeenCalledTimes(project ? 1 : 0)
  },
)
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
    const childIds = (['draft', 'running', 'review', 'failed', 'cancelled'] as const).map(
      (status) => {
        const child = first.tasks.create({
          title: `Child ${status}`,
          repositoryId: 'repo',
          agentId: 'agent',
          objective: 'Inspect',
        })
        first.store.updateTask(child.id, (task) => ({
          ...task,
          status,
          activeRunId:
            status === 'failed' || status === 'cancelled' ? `stale-${status}` : undefined,
          delegation: {
            parentTaskId: parent.id,
            parentRunId: 'retired-parent-attempt',
            key: status,
          },
        }))
        return child.id
      },
    )
    expect(first.store.task(childIds[0]).restartRecovery).toBeUndefined()
    await first.tasks.dispose()
    db.close()
    const run = vi.fn<AgentAdapter['run']>(async (context) => {
      expect(context.taskId).toBe(parent.id)
      expect(runtime.tasks.subagentList(parent.id).map((child) => child.status)).toEqual([
        'cancelled',
        'cancelled',
        'review',
        'failed',
        'cancelled',
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
        'failed',
        'cancelled',
      ]),
    )
    expect(runtime.tasks.subagentList(parent.id).every((child) => !child.running)).toBe(true)
    expect(runtime.store.task(parent.id).subagents?.map((child) => child.status)).toEqual([
      'stopped',
      'stopped',
      'completed',
      'failed',
      'stopped',
    ])
    expect(runtime.store.task(childIds[0]).restartRecovery).toBeUndefined()
    await expect(runtime.tasks.start(childIds[0])).rejects.toThrow('parent turn has ended')
    await waitForRecovery(() =>
      expect(runtime.store.task(parent.id).status).toBe(enabled ? 'review' : 'failed'),
    )
    expect(run).toHaveBeenCalledTimes(enabled ? 1 : 0)
  },
)
it.each([false, true])(
  'clears expired local child question notifications on restart (accepted=%s)',
  async (accepted) => {
    const f = await fixture()
    cleanups.push(f.cleanup)
    const path = join(f.directory, '.git', 'question-restart.sqlite')
    const token = 'synthetic-owner-token-for-restart-test'
    const db = openDatabase(path)
    const first = createServices(db, token)
    first.store.update(() => f.workspace)
    const parent = first.tasks.create({
      title: 'Parent',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: 'Work',
    })
    const child = first.tasks.create({
      title: 'Child',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: 'Inspect',
    })
    first.store.updateTask(child.id, (task) => ({
      ...task,
      delegation: {
        parentTaskId: parent.id,
        parentRunId: 'old-run',
        key: 'inspect',
        completion: 'pending',
      },
    }))
    const expired = {
      id: 'subagent-question:expired',
      role: 'user' as const,
      text: 'Answer an expired question',
      subagentResultId: child.id,
      createdAt: '',
    }
    const remote = {
      ...expired,
      id: 'subagent-question:remote',
      text: 'Answer a remote question',
      subagentResultId: 'remote-child',
    }
    const completion = { ...expired, id: 'completion', text: 'Retain a real completion' }
    first.store.updateTask(parent.id, (task) => ({
      ...task,
      status: 'running',
      activeRunId: 'old-run',
      subagentInbox: [expired, remote, completion],
      queue: [{ ...expired, id: 'subagent-question:legacy' }],
      runAttempt: {
        runId: 'old-run',
        inputMessageIds: [],
        promptAccepted: accepted,
        subagentInputs: [expired, remote, completion],
      },
    }))
    await first.tasks.dispose()
    db.close()
    const reopened = openDatabase(path)
    const runtime = createServices(reopened, token)
    cleanups.push(async () => {
      await runtime.tasks.dispose()
      if (reopened.open) reopened.close()
    })
    runtime.tasks.continueAfterRestart(() => false)
    const task = runtime.store.task(parent.id)
    expect(task.subagentInbox?.map((message) => message.id)).not.toContain(expired.id)
    expect(task.subagentInbox?.map((message) => message.id)).not.toContain(
      'subagent-question:legacy',
    )
    expect(task.subagentInbox?.map((message) => message.id)).toEqual(
      expect.arrayContaining([remote.id, completion.id]),
    )
    expect(task.runAttempt?.subagentInputs?.map((message) => message.id)).toEqual(
      accepted ? [expired.id, remote.id, completion.id] : [remote.id, completion.id],
    )
    expect(
      task.subagentInbox?.some((message) =>
        message.text.includes('Child interrupted by runtime restart'),
      ),
    ).toBe(true)
    expect(runtime.store.task(child.id).status).toBe('cancelled')
  },
)
it.each(['failed', 'cancelled'] as const)(
  'clears a stale %s run marker at startup without replaying queued input or uncertain actions',
  async (status) => {
    const messages: Task['messages'] = [
      { id: 'input', role: 'user', text: 'Original input', createdAt: '' },
      { id: 'partial', role: 'assistant', text: 'Retained output', createdAt: '' },
    ]
    const { options, id } = await seed(
      true,
      {
        status,
        activeRunId: 'unconfirmed-attempt',
        activity: 'Stale activity',
        error: 'Provider shutdown was not confirmed',
        messages,
        queue: [{ id: 'held', role: 'user', text: 'Do not replay', createdAt: '' }],
      },
      true,
    )
    const run = vi.fn<AgentAdapter['run']>(async () => {})
    adapter(run)
    const runtime = await startRuntime(options)
    cleanups.push(runtime.close)
    const s = runtime.services
    expect(s.store.task(id)).toMatchObject({
      status,
      error: 'Provider shutdown was not confirmed',
      queuePaused: true,
      messages,
    })
    expect(s.store.task(id).activeRunId).toBeUndefined()
    expect(s.store.task(id).activity).toBeUndefined()
    expect(s.store.task(id).queue).toHaveLength(1)
    expect(s.store.providerActions.state('unconfirmed')).toBe('uncertain')
    expect(s.tasks.hasWorkingFamily(id)).toBe(false)
    expect(() => s.tasks.requireIdle(id)).not.toThrow()
    expect(run).not.toHaveBeenCalled()
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
  // Review is saved before the worker's finalizer releases execution ownership.
  await waitForRecovery(() => expect(runtime.services.tasks.hasWorkingFamily(id)).toBe(false))
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

it('recovers the published Git tree after a failed SQLite save and restart', async () => {
  const { options, id } = await seed(true, { status: 'draft' })
  const run = vi.fn<AgentAdapter['run']>(async (input) => {
    await writeFile(join(input.cwd, 'hello.txt'), 'Written during the turn\n')
    input.onText('Saved reply')
  })
  adapter(run)
  const first = await startRuntime(options)
  cleanups.push(first.close)
  const { git, tasks, store } = first.services
  first.services.db.exec(`CREATE TEMP TRIGGER reject_final_save BEFORE UPDATE ON workspace_tasks
    WHEN json_extract(NEW.value, '$.status') = 'review' AND json_extract(NEW.value, '$.runPhase') IS NULL
    BEGIN SELECT RAISE(ABORT, 'Final SQLite write failed'); END`)
  await (
    await tasks.start(id)
  ).done
  const interrupted = store.task(id)
  expect(interrupted.error).toContain('Final SQLite write failed')
  const completed = interrupted.turns?.at(-1)
  expect(completed?.status).toBe('completed')
  expect(completed?.checkpoint?.after).toBeUndefined()
  const cwd = run.mock.calls[0][0].cwd
  const ref = `refs/dovo/checkpoints/${completed?.id}/after`
  const original = (await git.command(cwd, ['rev-parse', ref])).trim()
  expect(await git.command(cwd, ['show', `${original}:hello.txt`])).toBe(
    'Written during the turn\n',
  )
  await first.close()
  await writeFile(join(cwd, 'hello.txt'), 'Edited later by the user\n')

  const reopened = await startRuntime(options)
  cleanups.push(reopened.close)
  const response = await fetch(`http://127.0.0.1:${reopened.port}/api/tasks/run`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${options.ownerToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, saveOnly: true }),
  })
  expect(response.status).toBe(200)
  await waitForRecovery(() => expect(reopened.services.store.task(id).runPhase).toBeUndefined())
  const recovered = reopened.services.store.task(id)
  expect(recovered.turns).toHaveLength(1)
  expect(recovered.turns?.[0].checkpoint).toMatchObject({
    after: original,
    files: [expect.objectContaining({ path: 'hello.txt', after: 'Written during the turn\n' })],
  })
  expect((await reopened.services.git.command(cwd, ['rev-parse', ref])).trim()).toBe(original)
  expect(await readFile(join(cwd, 'hello.txt'), 'utf8')).toBe('Edited later by the user\n')
  expect(recovered.messages.filter((message) => message.role === 'assistant')).toMatchObject([
    { turnId: completed?.id, text: 'Saved reply' },
  ])
  expect(run).toHaveBeenCalledOnce()
})

it.skipIf(process.platform === 'win32').each(['before claim', 'after dispatch'] as const)(
  'keeps a saved reply and protects its queued follow-up when the runtime dies %s',
  async (cut) => {
    const f = await fixture()
    cleanups.push(f.cleanup)
    const options = {
      databasePath: join(f.directory, '.git', 'queued-turn-crash.sqlite'),
      ownerToken: 'synthetic-owner-token-for-restart-test',
      port: 0,
    }
    const initial = await startRuntime(options)
    let id: string
    try {
      initial.services.store.update(() => f.workspace)
      initial.services.preferences.save({ autoContinueAfterRestart: true })
      id = initial.services.tasks.create({
        title: 'Queued turn crash',
        repositoryId: 'repo',
        agentId: 'agent',
        objective: 'First request',
      }).id
    } finally {
      await initial.close()
    }

    await expect(
      promisify(execFile)(
        process.execPath,
        [
          '--import',
          new URL('../../../node_modules/tsx/dist/loader.mjs', import.meta.url).href,
          '--conditions=development',
          '--input-type=module',
          '--eval',
          `
          import assert from 'node:assert/strict';
          import { writeSync } from 'node:fs';
          import { startRuntime } from ${JSON.stringify(new URL('../../index.ts', import.meta.url).href)};
          const [id, rawOptions, cut] = process.argv.slice(1);
          const options = JSON.parse(rawOptions);
          const runtime = await startRuntime(options);
          const { agents, store, tasks } = runtime.services;
          let releaseFirst;
          let firstStarted;
          const firstReady = new Promise(resolve => { firstStarted = resolve; });
          const firstMayFinish = new Promise(resolve => { releaseFirst = resolve; });
          const crash = () => {
            const task = store.task(id);
            assert.equal(task.turns?.[0]?.status, 'completed');
            assert.equal(typeof task.turns[0].checkpoint?.after, 'string');
            assert.equal(task.messages.find(message => message.role === 'assistant')?.text, 'First reply');
            writeSync(1, 'first reply saved; crash ' + cut + '\\n');
            process.kill(process.pid, 'SIGKILL');
          };
          agents.get = async () => ({
            probe: async () => {},
            run: async (input) => {
              const task = store.task(id);
              if (task.runAttempt?.inputMessageIds.at(-1) === 'next') {
                assert.equal(cut, 'after dispatch');
                assert.match(input.prompt, /Queued follow-up/);
                assert.equal(task.queue?.length, 0);
                assert.equal(task.runAttempt.promptAccepted, false);
                assert.equal(store.providerActions.state('start:' + task.activeRunId), 'dispatched');
                crash();
                return;
              }
              assert.equal(task.runAttempt?.inputMessageIds.at(-1), 'first');
              input.onSession('queued-turn-session');
              input.onPromptAccepted();
              firstStarted();
              await firstMayFinish;
              input.onText('First reply');
            },
          });
          const take = tasks.queue.take.bind(tasks.queue);
          tasks.queue.take = (...args) => {
            const task = store.task(id);
            if (cut !== 'before claim' || task.queue?.[0]?.id !== 'next') return take(...args);
            assert.equal(task.runPhase, undefined);
            assert.equal(task.turns?.length, 1);
            crash();
          };
          const send = (messageId, text) => fetch('http://127.0.0.1:' + runtime.port + '/api/tasks/message', {
            method: 'POST',
            headers: { authorization: 'Bearer ' + options.ownerToken, 'content-type': 'application/json' },
            body: JSON.stringify({ id, messageId, text }),
          });
          assert.equal((await send('first', 'First request')).status, 200);
          await firstReady;
          assert.equal((await send('next', 'Queued follow-up')).status, 200);
          assert.deepEqual(store.task(id).queue?.map(message => message.id), ['next']);
          releaseFirst();
          `,
          id,
          JSON.stringify(options),
          cut,
        ],
        {
          cwd: f.directory,
          env: {
            PATH: process.env.PATH,
            HOME: f.directory,
            DOVO_BROWSER_EXECUTABLE: chromium.executablePath(),
            XDG_CONFIG_HOME: join(f.directory, 'config'),
            XDG_DATA_HOME: join(f.directory, 'data'),
            XDG_STATE_HOME: join(f.directory, 'state'),
          },
          timeout: 20_000,
        },
      ),
    ).rejects.toMatchObject({
      signal: 'SIGKILL',
      stdout: expect.stringContaining(`first reply saved; crash ${cut}\n`),
    })

    const run = vi.fn<AgentAdapter['run']>(async (input) => input.onText('Follow-up reply'))
    adapter(run)
    const restarted = await startRuntime(options)
    cleanups.push(restarted.close)
    const { store } = restarted.services
    const saved = store.task(id)
    const firstTurn = saved.turns?.[0]
    expect(firstTurn).toMatchObject({
      status: 'completed',
      checkpoint: { after: expect.any(String) },
    })
    expect(
      saved.messages.filter((message) => message.role === 'assistant' && message.text),
    ).toEqual([expect.objectContaining({ text: 'First reply', turnId: firstTurn?.id })])
    const next = expect.objectContaining({ id: 'next', text: 'Queued follow-up' })
    const dispatched = cut === 'after dispatch'
    expect(saved).toMatchObject({
      status: dispatched ? 'failed' : 'review',
      queuePaused: true,
      activeRunId: undefined,
      restartRecovery: { kind: dispatched ? 'turn' : 'queue', automatic: false },
      queue: dispatched ? [] : [next],
    })
    expect(saved.runAttempt?.inputMessageIds.at(-1)).toBe(dispatched ? 'next' : undefined)
    expect(saved.runAttempt?.promptAccepted).toBe(dispatched ? false : undefined)
    expect(saved.error?.includes('not confirmed') ?? false).toBe(dispatched)
    expect(saved.messages.filter((message) => message.id === 'next')).toEqual(
      dispatched ? [next] : [],
    )
    const actions = store.providerActions.list(id)
    const uncertainStart = expect.objectContaining({
      kind: 'start',
      attemptId: saved.turns?.[1]?.id,
    })
    expect(actions.filter((action) => action.state === 'uncertain')).toEqual(
      dispatched ? [uncertainStart] : [],
    )
    expect(run).not.toHaveBeenCalled()
    const post = (path: 'message' | 'queue', input: Record<string, unknown>) =>
      fetch(`http://127.0.0.1:${restarted.port}/api/tasks/${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.ownerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id, ...input }),
      })
    expect((await post('message', { messageId: 'next', text: 'Queued follow-up' })).status).toBe(
      200,
    )
    expect(store.task(id)).toEqual(saved)
    expect(store.providerActions.list(id)).toEqual(actions)
    expect(run).not.toHaveBeenCalled()
    if (dispatched) return

    expect((await post('queue', { action: 'resume' })).status).toBe(200)
    await waitForRecovery(() =>
      expect(store.task(id)).toMatchObject({
        status: 'review',
        activeRunId: undefined,
        queue: [],
        turns: [firstTurn, expect.objectContaining({ status: 'completed' })],
      }),
    )
    expect(run).toHaveBeenCalledOnce()
    expect(run.mock.calls[0][0].prompt).toContain('Queued follow-up')
    const finished = store.task(id)
    expect(finished.messages.filter((message) => message.role === 'assistant')).toMatchObject([
      { text: 'First reply', turnId: firstTurn?.id },
      { text: 'Follow-up reply', turnId: finished.turns?.[1]?.id },
    ])
    expect(finished.messages.filter((message) => message.id === 'next')).toHaveLength(1)
  },
)

it.skipIf(process.platform === 'win32')(
  'retains a steer without replaying it when the runtime dies inside the provider dispatch',
  async () => {
    const f = await fixture()
    cleanups.push(f.cleanup)
    const options = {
      databasePath: join(f.directory, '.git', 'steer-crash.sqlite'),
      ownerToken: 'synthetic-owner-token-for-restart-test',
      port: 0,
    }
    const initial = await startRuntime(options)
    let id: string
    try {
      initial.services.store.update(() => f.workspace)
      initial.services.preferences.save({ autoContinueAfterRestart: true })
      id = initial.services.tasks.create({
        title: 'Steer crash',
        repositoryId: 'repo',
        agentId: 'agent',
        objective: 'Original request',
      }).id
    } finally {
      await initial.close()
    }

    await expect(
      promisify(execFile)(
        process.execPath,
        [
          '--import',
          new URL('../../../node_modules/tsx/dist/loader.mjs', import.meta.url).href,
          '--conditions=development',
          '--input-type=module',
          '--eval',
          `
          import assert from 'node:assert/strict';
          import { startRuntime } from ${JSON.stringify(new URL('../../index.ts', import.meta.url).href)};
          const [taskId, rawOptions] = process.argv.slice(1);
          const options = JSON.parse(rawOptions);
          const runtime = await startRuntime(options);
          const { agents, store, tasks } = runtime.services;
          let ready;
          const steeringRegistered = new Promise(resolve => { ready = resolve; });
          agents.get = async () => ({
            probe: async () => {},
            run: async (input) => {
              input.onSession('steering-session');
              input.onPromptAccepted();
              input.onSteer(async (message) => {
                assert.equal(message.id, 'in-flight-steer');
                assert.equal(message.prompt, 'Keep this instruction');
                assert.equal(store.providerActions.list(taskId).find(action => action.kind === 'steer')?.state, 'dispatched');
                process.stdout.write('steer dispatched\\n', () => process.kill(process.pid, 'SIGKILL'));
                await new Promise(() => {});
              });
              ready();
              await new Promise(() => {});
            }
          });
          await tasks.start(taskId);
          await steeringRegistered;
          const response = await fetch('http://127.0.0.1:' + runtime.port + '/api/tasks/steer', {
            method: 'POST',
            headers: { authorization: 'Bearer ' + options.ownerToken, 'content-type': 'application/json' },
            body: JSON.stringify({
              id: taskId, messageId: 'in-flight-steer', text: 'Keep this instruction',
              runId: store.task(taskId).activeRunId,
            }),
          });
          throw new Error('Unexpected steer response: ' + response.status + ' ' + await response.text());
          `,
          id,
          JSON.stringify(options),
        ],
        {
          cwd: f.directory,
          env: {
            PATH: process.env.PATH,
            HOME: f.directory,
            DOVO_BROWSER_EXECUTABLE: chromium.executablePath(),
            XDG_CONFIG_HOME: join(f.directory, 'config'),
            XDG_DATA_HOME: join(f.directory, 'data'),
            XDG_STATE_HOME: join(f.directory, 'state'),
          },
          timeout: 20_000,
        },
      ),
    ).rejects.toMatchObject({
      signal: 'SIGKILL',
      stdout: expect.stringContaining('steer dispatched\n'),
    })

    const run = vi.fn<AgentAdapter['run']>(async () => {})
    adapter(run)
    const recovered = await startRuntime(options)
    cleanups.push(recovered.close)
    const { store } = recovered.services
    await waitForRecovery(() => expect(store.task(id).restartRecovery?.automatic).toBe(false))
    expect(store.providerActions.list(id)).toContainEqual(
      expect.objectContaining({ kind: 'steer', state: 'uncertain' }),
    )
    expect(store.task(id)).toMatchObject({
      queuePaused: true,
      queue: [expect.objectContaining({ id: 'in-flight-steer', text: 'Keep this instruction' })],
    })
    expect(run).not.toHaveBeenCalled()
  },
)

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
  first.services.store.updateTaskHistory(child.id, (task) => ({
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
  expect(second.services.store.task(parent.id).subagentInbox?.[0]?.text).toContain(
    'Recovered child answer',
  )
  expect(second.services.store.task(parent.id).queuePaused).toBe(true)
  expect(run).not.toHaveBeenCalled()
  expect(second.services.store.task(child.id).delegation?.completion).toBe('queued')
  await second.close()
  const third = await startRuntime(options)
  cleanups.push(third.close)
  expect(third.services.store.task(parent.id).subagentInbox).toHaveLength(1)
  expect(run).not.toHaveBeenCalled()
  await (
    await third.services.tasks.start(parent.id)
  ).done
  expect(run).toHaveBeenCalledOnce()
  expect(run.mock.calls[0][0].prompt).toContain('Recovered child answer')
  expect(third.services.store.task(parent.id).queue ?? []).toEqual([])
  expect(third.services.store.task(parent.id).subagentInbox).toEqual([])
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
  expect(task.subagentInbox?.[0]?.text).toContain('Child interrupted by runtime restart')
  expect(restarted.services.store.task(childId).delegation?.completion).toBe('queued')
  expect(resumed).not.toHaveBeenCalled()
  await (
    await restarted.services.tasks.start(parent.id)
  ).done
  expect(resumed).toHaveBeenCalledOnce()
  expect(resumed.mock.calls[0][0].prompt).toContain('Child interrupted by runtime restart')
})

it.each([false, true])(
  'uses the explicit resume choice %s for this restart without changing preferences',
  async (resumeInterrupted) => {
    const f = await fixture()
    cleanups.push(f.cleanup)
    const options = {
      databasePath: join(f.directory, '.git', 'restart-choice.sqlite'),
      ownerToken: 'synthetic-owner-token-for-restart-test',
      port: 0,
    }
    const runtime = await startRuntime(options)
    runtime.services.store.update(() => f.workspace)
    runtime.services.preferences.save({ autoContinueAfterRestart: !resumeInterrupted })
    const task = runtime.services.tasks.create({
      title: 'Restart choice',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: 'Continue this work',
    })
    let allocated = false
    const lookup = adapter(async (context) => {
      context.onSession('restart-choice-session')
      context.onPromptAccepted?.()
      allocated = true
      await new Promise<void>((resolve) =>
        context.signal.addEventListener('abort', () => resolve(), { once: true }),
      )
      context.signal.throwIfAborted()
    })
    await runtime.services.tasks.start(task.id)
    await waitForRecovery(() => expect(allocated).toBe(true))
    runtime.services.tasks.prepareRestart(resumeInterrupted)
    await runtime.close()
    const run = vi.fn<AgentAdapter['run']>(async (context) => context.onText('Recovered'))
    lookup.mockResolvedValue({ probe: vi.fn<AgentAdapter['probe']>(), run })
    const restarted = await startRuntime(options)
    cleanups.push(restarted.close)
    await waitForRecovery(() =>
      expect(restarted.services.store.task(task.id).status).toBe(
        resumeInterrupted ? 'review' : 'cancelled',
      ),
    )
    expect(run).toHaveBeenCalledTimes(resumeInterrupted ? 1 : 0)
    const recovery = restarted.services.store.task(task.id).restartRecovery
    expect(
      recovery && { automatic: recovery.automatic, resumeRequested: recovery.resumeRequested },
    ).toEqual(resumeInterrupted ? undefined : { automatic: false, resumeRequested: false })
    expect(restarted.services.preferences.get().autoContinueAfterRestart).toBe(!resumeInterrupted)
  },
)

it('recovers the interrupted turn with its saved model choices while leaving thread defaults intact', async () => {
  const turnSettings = { provider: 'codex' as const, model: 'queued-model', reasoning: 'high' }
  const { options, id } = await seed(true, {
    runAttempt: { runId: 'interrupted', inputMessageIds: [], promptAccepted: false, turnSettings },
  })
  const runs: AgentRun[] = []
  adapter(async (run) => {
    runs.push(run)
    run.onText('Recovered')
  })
  const runtime = await startRuntime(options)
  cleanups.push(runtime.close)
  await waitForRecovery(() => expect(runtime.services.store.task(id).status).toBe('review'))
  expect(runs).toHaveLength(1)
  expect(runs[0].agent).toMatchObject({ model: 'queued-model', reasoning: 'high' })
  expect(runtime.services.store.get().agents[0].model).toBe('')
  expect(runtime.services.store.task(id).agentOverrides?.model).toBeUndefined()
  // Review is saved before the worker's finalizer releases execution ownership.
  await waitForRecovery(() => expect(runtime.services.tasks.hasWorkingFamily(id)).toBe(false))
  await (
    await runtime.services.tasks.start(id)
  ).done
  expect(runs.at(-1)?.agent.model).toBe('')
})
