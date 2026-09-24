import { decode } from '@dovo/protocol'
import type { AgentAdapter } from '../agents/types'
import { afterEach, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { startRuntime } from '../index'
import { fixture } from '../testing/fixture'
import { responses, type Automation, type AutomationData } from '@dovo/protocol'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
it(
  'persists review gates across restart and deduplicates external deliveries',
  {
    timeout: 15000,
  },
  async () => {
    const f = await fixture()
    cleanups.push(f.cleanup)
    const options = {
      databasePath: join(f.directory, 'runtime.sqlite'),
      ownerToken: 'test-owner-token-with-at-least-32-characters',
      port: 0,
    }
    let runtime = await startRuntime(options)
    cleanups.push(() => runtime.close())
    const flow = createFlow()
    runtime.services.store.update(() => ({
      ...f.workspace,
      automations: [flow],
    }))
    vi.spyOn(runtime.services.agents, 'get').mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run: async (run) => run.onText('Done'),
    })
    const id = runtime.services.jobs.start('flow', 'delivery-1')
    // This runs the real checkout/checkpoint subprocesses, which can exceed waitFor's 1s default on CI.
    await vi.waitFor(() => expect(runtime.services.jobs.list()[0].status).toBe('waiting'), {
      timeout: 10000,
    })
    expect(runtime.services.jobs.list()[0].taskIds).toHaveLength(1)
    expect(
      runtime.services.activity
        .list('', 'job', 0)
        .events.some((e) => e.summary.endsWith('waiting')),
    ).toBe(true)
    expect(
      runtime.services.activity
        .list('', 'agent', 0)
        .events.some((e) => e.summary.endsWith('turn started')),
    ).toBe(true)
    await runtime.services.jobs.shutdown()
    expect(() => runtime.services.jobs.approve(id, true)).toThrow('Runtime is shutting down')
    expect(() => runtime.services.jobs.approve(id, false)).toThrow('Runtime is shutting down')
    expect(runtime.services.jobs.list()[0].status).toBe('waiting')
    await runtime.close()
    runtime = await startRuntime(options)
    expect(runtime.services.jobs.list()[0].status).toBe('waiting')
    runtime.services.jobs.approve(id, true)
    await vi.waitFor(() => expect(runtime.services.jobs.list()[0].status).toBe('completed'))
    expect(() => runtime.services.jobs.start('flow', 'delivery-1')).toThrow('already delivered')
  },
)
function createFlow(): Automation {
  const base: AutomationData = {
    kind: 'trigger',
    label: 'Trigger',
    trigger: 'manual',
    schedule: '',
    timezone: 'UTC',
    objective: 'Do work',
    agentId: 'agent',
    repositoryId: 'repo',
  }
  const flow: Automation = {
    id: 'flow',
    name: 'Test',
    nodes: ['trigger', 'task', 'review'].map((id, index) => ({
      id,
      type: 'automation',
      position: {
        x: index * 100,
        y: 0,
      },
      data: {
        ...base,
        kind: index === 0 ? 'trigger' : index === 1 ? 'task' : 'review',
      },
    })),
    edges: [
      {
        id: 'one',
        source: 'trigger',
        target: 'task',
      },
      {
        id: 'two',
        source: 'task',
        target: 'review',
      },
    ],
  }
  return flow
}
it('fires due schedules and authenticates webhook payload delivery', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const token = 'test-owner-token-with-at-least-32-characters'
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: token,
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.jobs.dispose()
  const flow = createFlow()
  flow.enabled = true
  flow.nodes[0].data.trigger = 'schedule'
  flow.nodes[0].data.schedule = '* * * * *'
  s.store.update(() => ({
    ...f.workspace,
    automations: [flow],
  }))
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async () => {},
  })
  const now = Date.parse('2026-09-07T12:00:00Z')
  s.jobs.tick(now)
  expect(s.jobs.list()).toHaveLength(0)
  s.jobs.tick(now + 60000)
  await vi.waitFor(() => expect(s.jobs.list()[0].status).toBe('waiting'))
  s.jobs.approve(s.jobs.list()[0].id, true)
  await vi.waitFor(() => expect(s.jobs.list()[0].status).toBe('completed'))
  s.jobs.tick(now + 60000)
  expect(s.jobs.list()).toHaveLength(1)
  s.store.update((w) => ({
    ...w,
    automations: w.automations.map((a) => ({
      ...a,
      nodes: a.nodes.map((n) =>
        n.data.kind === 'trigger'
          ? {
              ...n,
              data: {
                ...n.data,
                trigger: 'webhook',
              },
            }
          : n,
      ),
    })),
  }))
  const post = (path: string, credential: string, payload: unknown) =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credential}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': 'delivery-test',
      },
      body: JSON.stringify(payload),
    })
  const hook = decode(
    responses.webhook,
    await (
      await post('/api/jobs/webhook-secret', token, {
        id: flow.id,
      })
    ).json(),
  )
  expect((await post(hook.path, 'wrong', {})).status).toBe(401)
  expect(
    (
      await post(hook.path, hook.secret, {
        issue: 42,
      })
    ).status,
  ).toBe(200)
  expect(s.activity.list('Webhook received', 'integration', 0).events[0].payload).toContain('42')
  await vi.waitFor(() => expect(s.jobs.list()[0].status).toBe('waiting'))
  expect(s.store.task(s.jobs.list()[0].taskIds[0]).messages[0].text).toContain('"issue": 42')
  s.jobs.approve(s.jobs.list()[0].id, true)
  await vi.waitFor(() => expect(s.jobs.list()[0].status).toBe('completed'))
  expect(
    (
      await post(hook.path, hook.secret, {
        issue: 42,
      })
    ).status,
  ).toBe(409)
})
it('isolates broken schedules and resets due times when trigger modes change', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'test-owner-token-with-at-least-32-characters',
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.jobs.dispose()
  const valid = createFlow()
  valid.enabled = true
  valid.nodes[0].data.trigger = 'schedule'
  valid.nodes[0].data.schedule = '* * * * *'
  const broken = structuredClone(valid)
  broken.id = 'broken'
  broken.nodes[0].data.schedule = 'invalid'
  s.store.update(() => ({
    ...f.workspace,
    automations: [broken, valid],
  }))
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async () => {},
  })
  const now = Date.parse('2026-09-07T12:00:00Z')
  s.jobs.tick(now)
  s.jobs.tick(now + 60000)
  await vi.waitFor(() => expect(s.jobs.list()[0]?.status).toBe('waiting'))
  expect(s.jobs.list()[0].automationId).toBe(valid.id)
  expect(errors).toHaveBeenCalledTimes(1)
  const id = s.jobs.list()[0].id
  s.jobs.cancel(id)
  expect(s.jobs.list()[0].waitingNodeId).toBeUndefined()
  expect(() => s.jobs.cancel(id)).toThrow('already finished')
  const changeTrigger = (trigger: 'manual' | 'schedule') =>
    s.store.update((w) => ({
      ...w,
      automations: w.automations.map((flow) =>
        flow.id === valid.id
          ? {
              ...flow,
              nodes: flow.nodes.map((node) =>
                node.data.kind === 'trigger'
                  ? {
                      ...node,
                      data: {
                        ...node.data,
                        trigger,
                      },
                    }
                  : node,
              ),
            }
          : flow,
      ),
    }))
  changeTrigger('manual')
  s.jobs.tick(now + 90000)
  changeTrigger('schedule')
  s.jobs.tick(now + 180000)
  expect(s.jobs.list()).toHaveLength(1)
  s.jobs.tick(now + 240000)
  await vi.waitFor(() => expect(s.jobs.list()[0]?.status).toBe('waiting'))
  expect(s.jobs.list()).toHaveLength(2)
})
it('does not advance a cancelled task into a review gate', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'test-owner-token-with-at-least-32-characters',
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.store.update(() => ({
    ...f.workspace,
    automations: [createFlow()],
  }))
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) =>
      new Promise<void>((_resolve, reject) =>
        run.signal.addEventListener('abort', () => reject(run.signal.reason), {
          once: true,
        }),
      ),
  })
  const id = s.jobs.start('flow')
  await vi.waitFor(() =>
    expect(s.store.get().tasks.some((task) => task.status === 'running')).toBe(true),
  )
  s.jobs.cancel(id)
  await vi.waitFor(() =>
    expect(s.store.get().tasks.find((task) => task.origin === 'flow')?.status).toBe('cancelled'),
  )
  expect(s.jobs.list()[0].status).toBe('cancelled')
  expect(s.jobs.list()[0].completedNodes).not.toContain('task')
})
it('retries only the failed task, retaining successful steps and approved reviews', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'test-owner-token-with-at-least-32-characters',
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  const flow = createFlow()
  flow.nodes[1].data.objective = 'First step'
  flow.nodes.splice(
    2,
    0,
    {
      ...structuredClone(flow.nodes[2]),
      id: 'middle-review',
      data: {
        ...flow.nodes[2].data,
        label: 'Approve first step',
      },
    },
    {
      ...structuredClone(flow.nodes[1]),
      id: 'second-task',
      data: {
        ...flow.nodes[1].data,
        label: 'Second step',
        objective: 'Second step',
      },
    },
  )
  flow.edges = [
    {
      id: 'one',
      source: 'trigger',
      target: 'task',
    },
    {
      id: 'two',
      source: 'task',
      target: 'middle-review',
    },
    {
      id: 'three',
      source: 'middle-review',
      target: 'second-task',
    },
    {
      id: 'four',
      source: 'second-task',
      target: 'review',
    },
  ]
  s.store.update(() => ({
    ...f.workspace,
    automations: [flow],
  }))
  let fail = true
  const execute = vi.fn<AgentAdapter['run']>(async (run) => {
    if (run.prompt.includes('Second step') && fail) {
      run.onSession('second-step-session')
      run.onText('Partial work')
      throw new Error('Provider disconnected')
    }
    run.onText('Done')
  })
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: execute,
  })
  const id = s.jobs.startManual(flow.id, 'request-one')
  await vi.waitFor(() => expect(s.jobs.list()[0].waitingNodeId).toBe('middle-review'))
  s.jobs.approve(id, true)
  await vi.waitFor(() => expect(s.jobs.list()[0].status).toBe('failed'))
  const failed = s.jobs.list()[0]
  expect(failed.failedNodeId).toBe('second-task')
  expect(failed.currentNodeId).toBeUndefined()
  expect(failed.finishedAt).toBeTypeOf('string')
  expect(failed.steps?.find((step) => step.nodeId === 'second-task')).toMatchObject({
    status: 'failed',
    attempt: 1,
    error: 'Provider disconnected',
    taskId: failed.taskIds[1],
    startedAt: expect.any(String),
    finishedAt: expect.any(String),
  })
  expect(failed.completedNodes).toEqual(['trigger', 'task', 'middle-review'])
  fail = false
  expect(s.jobs.retry(id)).toBe(id)
  await vi.waitFor(() => expect(s.jobs.list()[0].waitingNodeId).toBe('review'))
  const retried = s.jobs.list()[0]
  expect(retried.taskIds).toEqual(failed.taskIds)
  expect(s.store.get().tasks).toHaveLength(2)
  expect(execute).toHaveBeenCalledTimes(3)
  expect(execute.mock.calls[2][0].sessionId).toBe('second-step-session')
  expect(execute.mock.calls[2][0].cwd).toBe(execute.mock.calls[1][0].cwd)
  expect(execute.mock.calls[2][0].agent).toEqual(execute.mock.calls[1][0].agent)
  // Output proves this request was accepted; resume its saved session without resending it.
  expect(execute.mock.calls[2][0].prompt).toContain('Continue the task')
  expect(execute.mock.calls[2][0].prompt).not.toContain('Second step')
  expect(retried.attempt).toBe(2)
  expect(retried.steps?.find((step) => step.nodeId === 'task')).toEqual(
    failed.steps?.find((step) => step.nodeId === 'task'),
  )
  expect(retried.steps?.find((step) => step.nodeId === 'middle-review')).toEqual(
    failed.steps?.find((step) => step.nodeId === 'middle-review'),
  )
  expect(retried.steps?.find((step) => step.nodeId === 'second-task')).toMatchObject({
    status: 'completed',
    attempt: 2,
    taskId: failed.taskIds[1],
  })
  s.jobs.approve(id, true)
  await vi.waitFor(() => expect(s.jobs.list()[0].status).toBe('completed'))
})
it('cancels during checkout preparation and retries the same unfinished task', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'test-owner-token-with-at-least-32-characters',
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.store.update(() => ({
    ...f.workspace,
    automations: [createFlow()],
  }))
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const directory = s.checkouts.directory.bind(s.checkouts)
  vi.spyOn(s.checkouts, 'directory').mockImplementationOnce(async (id) => {
    await gate
    return directory(id)
  })
  const execute = vi.fn<AgentAdapter['run']>(async () => {})
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: execute,
  })
  const id = s.jobs.start('flow')
  await vi.waitFor(() => expect(s.store.get().tasks[0]?.activity).toBe('Preparing checkout'))
  const taskId = s.jobs.list()[0].taskIds[0]
  s.jobs.cancel(id)
  expect(() => s.jobs.retry(id)).toThrow('Wait for the current step to stop')
  release()
  await vi.waitFor(() => expect(s.store.task(taskId).status).toBe('cancelled'))
  expect(execute).not.toHaveBeenCalled()
  expect(s.jobs.list()[0].steps?.find((step) => step.nodeId === 'task')).toMatchObject({
    status: 'cancelled',
    taskId,
    finishedAt: expect.any(String),
  })
  s.jobs.retry(id)
  await vi.waitFor(() => expect(s.jobs.list()[0].status).toBe('waiting'))
  expect(s.jobs.list()[0].taskIds).toEqual([taskId])
  expect(execute).toHaveBeenCalledTimes(1)
})
it('accepts manual requests atomically and returns the same run after response loss or restart', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const token = 'test-owner-token-with-at-least-32-characters'
  const options = {
    databasePath: join(f.directory, 'manual.sqlite'),
    ownerToken: token,
    port: 0,
  }
  let runtime = await startRuntime(options)
  cleanups.push(() => runtime.close())
  const flow = createFlow()
  flow.edges = [
    {
      id: 'one',
      source: 'trigger',
      target: 'review',
    },
    {
      id: 'two',
      source: 'review',
      target: 'task',
    },
  ]
  runtime.services.store.update(() => ({
    ...f.workspace,
    automations: [flow],
  }))
  runtime.services.db.exec(
    "CREATE TRIGGER fail_job_acceptance BEFORE INSERT ON job_runs BEGIN SELECT RAISE(ABORT, 'fixture write failure'); END",
  )
  expect(() => runtime.services.jobs.startManual('flow', 'request')).toThrow(
    'fixture write failure',
  )
  expect(runtime.services.jobs.list()).toHaveLength(0)
  expect(runtime.services.db.prepare('SELECT * FROM deliveries').all()).toHaveLength(0)
  runtime.services.db.exec('DROP TRIGGER fail_job_acceptance')
  const post = () =>
    fetch(`http://127.0.0.1:${runtime.port}/api/jobs/run`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: 'flow',
        requestId: 'request',
      }),
    })
  const responses = await Promise.all([post(), post()])
  expect(responses.map((response) => response.status)).toEqual([200, 200])
  const accepted = await Promise.all(responses.map((response) => response.json()))
  expect(accepted[1]).toEqual(accepted[0])
  expect(runtime.services.jobs.list()).toHaveLength(1)
  expect(() => runtime.services.jobs.startManual('flow', 'another-request')).toThrow(
    'already has an active run',
  )
  await runtime.close()
  runtime = await startRuntime(options)
  const replay = await post()
  expect(replay.status).toBe(200)
  expect(await replay.json()).toEqual(accepted[0])
  expect(runtime.services.jobs.list()[0].status).toBe('waiting')
  expect(runtime.services.store.get().tasks).toHaveLength(0)
})
it('shuts down running jobs before storage closes and resumes interrupted work explicitly', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const options = {
    databasePath: join(f.directory, 'shutdown.sqlite'),
    ownerToken: 'test-owner-token-with-at-least-32-characters',
    port: 0,
  }
  let runtime = await startRuntime(options)
  cleanups.push(() => runtime.close())
  runtime.services.store.update(() => ({
    ...f.workspace,
    automations: [createFlow()],
  }))
  const execute = vi.fn<AgentAdapter['run']>(
    async (run) =>
      new Promise<void>((_resolve, reject) => {
        run.signal.addEventListener('abort', () => reject(run.signal.reason), {
          once: true,
        })
      }),
  )
  vi.spyOn(runtime.services.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: execute,
  })
  const id = runtime.services.jobs.start('flow')
  await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
  const taskId = runtime.services.jobs.list()[0].taskIds[0]
  await runtime.close()
  runtime = await startRuntime(options)
  const interrupted = runtime.services.jobs.list()[0]
  expect(interrupted).toMatchObject({
    id,
    status: 'failed',
    interrupted: true,
    failedNodeId: 'task',
  })
  expect(interrupted.steps?.find((step) => step.nodeId === 'task')).toMatchObject({
    taskId,
    status: 'failed',
    finishedAt: expect.any(String),
  })
  vi.spyOn(runtime.services.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async () => {},
  })
  const response = await fetch(`http://127.0.0.1:${runtime.port}/api/jobs/retry`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.ownerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id,
    }),
  })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    id,
  })
  await vi.waitFor(() => expect(runtime.services.jobs.list()[0].status).toBe('waiting'))
  expect(runtime.services.jobs.list()[0].taskIds).toEqual([taskId])
})
it.each([false, true])(
  'recovers completed tasks without rerunning them after a crash (legacy metadata: %s)',
  async (legacy) => {
    const f = await fixture()
    cleanups.push(f.cleanup)
    const options = {
      databasePath: join(f.directory, 'recover.sqlite'),
      ownerToken: 'test-owner-token-with-at-least-32-characters',
      port: 0,
    }
    let runtime = await startRuntime(options)
    cleanups.push(() => runtime.close())
    runtime.services.store.update(() => ({
      ...f.workspace,
      automations: [createFlow()],
    }))
    vi.spyOn(runtime.services.agents, 'get').mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run: async () => {},
    })
    const id = runtime.services.jobs.start('flow')
    await vi.waitFor(() => expect(runtime.services.jobs.list()[0].status).toBe('waiting'))
    const original = runtime.services.jobs.list()[0]
    // Simulate a crash after the task persisted success but before Jobs committed the step.
    const stored = {
      ...original,
      flow: createFlow(),
      status: 'running',
      completedNodes: ['trigger'],
      waitingNodeId: undefined,
      currentNodeId: 'task',
      steps: legacy
        ? undefined
        : original.steps?.map((step) => ({
            ...step,
            status:
              step.nodeId === 'trigger'
                ? 'completed'
                : step.nodeId === 'task'
                  ? 'running'
                  : 'pending',
          })),
    }
    runtime.services.db
      .prepare('UPDATE job_runs SET value=? WHERE id=?')
      .run(JSON.stringify(stored), id)
    await runtime.close()
    runtime = await startRuntime(options)
    const execute = vi.fn<AgentAdapter['run']>(async () => {})
    vi.spyOn(runtime.services.agents, 'get').mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run: execute,
    })
    expect(runtime.services.jobs.list()[0]).toMatchObject({
      status: 'failed',
      interrupted: true,
      completedNodes: ['trigger', 'task'],
    })
    runtime.services.jobs.retry(id)
    await vi.waitFor(() => expect(runtime.services.jobs.list()[0].status).toBe('waiting'))
    expect(runtime.services.jobs.list()[0].taskIds).toEqual(original.taskIds)
    expect(runtime.services.store.get().tasks).toHaveLength(1)
    expect(execute).not.toHaveBeenCalled()
  },
)
it('rolls back task creation when persisting its step association fails', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'test-owner-token-with-at-least-32-characters',
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.store.update(() => ({
    ...f.workspace,
    automations: [createFlow()],
  }))
  s.db.exec(
    "CREATE TRIGGER fail_task_link BEFORE UPDATE OF value ON job_runs WHEN json_array_length(NEW.value, '$.taskIds') > 0 BEGIN SELECT RAISE(ABORT, 'fixture task link failure'); END",
  )
  const execute = vi.fn<AgentAdapter['run']>(async () => {})
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: execute,
  })
  const id = s.jobs.start('flow')
  await vi.waitFor(() => expect(s.jobs.list()[0].status).toBe('failed'))
  expect(s.jobs.list()[0].error).toContain('fixture task link failure')
  expect(s.jobs.list()[0].taskIds).toEqual([])
  expect(s.store.get().tasks).toEqual([])
  expect(execute).not.toHaveBeenCalled()
  s.db.exec('DROP TRIGGER fail_task_link')
  s.jobs.retry(id)
  await vi.waitFor(() => expect(s.jobs.list()[0].status).toBe('waiting'))
  expect(s.store.get().tasks).toHaveLength(1)
  expect(execute).toHaveBeenCalledTimes(1)
})
