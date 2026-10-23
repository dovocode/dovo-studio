import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { Schema } from 'effect'
import { decode, mutableStruct } from '@dovo/protocol'
import type { AgentAdapter } from '../../agents/execution/types.js'
import type { ForgePipelineDetail } from '@dovo/protocol'
import { startRuntime } from '../../index.js'
import { fixture } from '../../testing/fixture.js'
import { PipelineWatch } from './pipeline-watch.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.restoreAllMocks()
})
const runId = (input: unknown) => decode(mutableStruct({ id: Schema.String }), input).id
const token = 'pipeline-watch-owner-token-at-least-32-characters'
const detail = (
  id = '7',
  status = 'in_progress',
  extra: Partial<ForgePipelineDetail> = {},
): ForgePipelineDetail & { cachedAt: string } => ({
  run: {
    id,
    title: 'Build',
    url: `https://github.com/team/project/actions/runs/${id}`,
    ref: 'fix',
    sha: 'a'.repeat(40),
    actor: 'author',
    status,
    createdAt: '2026-10-09T10:00:00Z',
    updatedAt: '2026-10-09T10:00:00Z',
  },
  jobs: [],
  ...extra,
  cachedAt: extra.cachedAt ?? new Date().toISOString(),
})
async function setup(persistent = false) {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: persistent ? join(f.directory, 'runtime.sqlite') : ':memory:',
    ownerToken: token,
    port: 0,
  })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.store.update(() => f.workspace)
  const task = s.tasks.create({
    title: 'Fix',
    agentId: 'agent',
    repositoryId: 'repo',
    objective: '',
  })
  s.store.updateTask(task.id, (task) => ({ ...task, queuePaused: true, queue: [] }))
  s.preferences.save({ enablePipelineWatching: true })
  const read = vi
    .spyOn(s.forgeWork, 'request')
    .mockImplementation(async (_repo, _operation, input) => {
      const id = runId(input)
      return detail(id)
    })
  const watch = (runIds = ['7']) =>
    s.pipelineWatch.command({ taskId: task.id, action: 'watch', runIds })
  const status = () => s.pipelineWatch.command({ taskId: task.id, action: 'status' })
  return { f, runtime, s, taskId: task.id, read, watch, status }
}
it('skips watch scans during streaming and restores ownership after a rolled-back archive', async () => {
  const f = await setup()
  f.s.store.updateTask(f.taskId, (task) => ({ ...task, status: 'review' }))
  await f.watch()
  const prepare = vi.spyOn(f.s.db, 'prepare')
  for (let index = 0; index < 20; index++)
    f.s.store.updateTask(f.taskId, (task) => ({ ...task, activity: `token-${index}` }))
  const scans = () =>
    prepare.mock.calls.filter(([sql]) => sql === 'SELECT value FROM task_pipeline_watches').length
  expect(scans()).toBe(0)
  expect(f.s.store.task(f.taskId).waitingForFeedback).toBe(true)
  expect(() =>
    f.s.store.transaction(() => {
      f.s.store.updateTask(f.taskId, (task) => ({ ...task, archived: true }))
      throw new Error('Rollback archive')
    }),
  ).toThrow('Rollback archive')
  f.s.store.updateTask(f.taskId, (task) => ({ ...task, activity: 'resumed' }))
  // Each lifecycle boundary refreshes ownership and the cached overview counts.
  expect(scans()).toBe(4)
  expect(f.s.store.task(f.taskId).waitingForFeedback).toBe(true)
  expect((await f.status()).watches[0]?.status).toBe('watching')
  await f.s.pipelineWatch.command({ taskId: f.taskId, action: 'stop' })
  expect(f.s.store.task(f.taskId).waitingForFeedback).toBeUndefined()
})

async function linkedSetup(persistent = false) {
  const f = await setup(persistent)
  f.s.store.update((workspace) => ({
    ...workspace,
    repositories: [
      ...workspace.repositories,
      { id: 'linked', name: 'Linked', path: join(f.f.directory, 'linked'), branch: 'main' },
    ],
    tasks: workspace.tasks.map((task) =>
      task.id === f.taskId
        ? {
            ...task,
            status: 'review',
            linkedCheckouts: [
              { id: 'linked', repositoryId: 'linked', access: 'edit', execution: 'main' },
            ],
          }
        : task,
    ),
  }))
  const linkedWatch = (runIds = ['7']) =>
    f.s.pipelineWatch.command({ taskId: f.taskId, repositoryId: 'linked', action: 'watch', runIds })
  return { ...f, linkedWatch }
}

it('adds explicit runs, preserves existing watches and delivers each completion once without unpausing', async () => {
  const f = await setup()
  await f.watch(['7', '8'])
  await f.watch(['9'])
  await f.watch(['7'])
  expect((await f.status()).watches).toHaveLength(3)
  expect(f.read).toHaveBeenCalledWith('repo', 'pipelines/detail', { id: '7', refresh: true }, false)
  await f.s.pipelineWatch.tick()
  expect(f.s.store.task(f.taskId).queue).toHaveLength(0)
  f.read.mockImplementation(async (_repo, _operation, input) => detail(runId(input), 'failure'))
  await f.s.pipelineWatch.tick()
  await f.s.pipelineWatch.tick()
  expect(f.s.store.task(f.taskId).queue).toHaveLength(3)
  expect(f.s.store.task(f.taskId).queuePaused).toBe(true)
  expect(f.s.store.task(f.taskId).queue?.[0]?.text).toContain('Status: failure')
  expect((await f.status()).watches.every((state) => state.status === 'completed')).toBe(true)
})

it('returns already finished runs immediately, including successful and cancelled runs', async () => {
  const f = await setup()
  for (const status of ['success', 'cancelled']) {
    f.read.mockResolvedValue(detail('7', status))
    expect(await f.watch()).toMatchObject({
      watches: [{ status: 'completed', runStatus: status }],
      runs: [{ run: { status } }],
    })
  }
  await f.s.pipelineWatch.tick()
  expect(f.s.store.task(f.taskId).queue).toHaveLength(0)
})

it('awaits fresh pipeline details on every poll instead of cycling through stale cached reads', async () => {
  const f = await setup()
  await f.watch()
  f.read.mockImplementation(async (_repo, _operation, input) => {
    const query = decode(mutableStruct({ id: Schema.String, refresh: Schema.Boolean }), input)
    return query.refresh
      ? detail(query.id, 'failure')
      : detail(query.id, 'in_progress', { stale: true })
  })
  await f.s.pipelineWatch.tick()
  expect(await f.status()).toMatchObject({
    watches: [{ status: 'completed', runStatus: 'failure' }],
  })
  expect(f.s.store.task(f.taskId).queue).toHaveLength(1)
  await f.s.pipelineWatch.tick()
  expect(f.s.store.task(f.taskId).queue).toHaveLength(1)
})

it('stops selected watches and rejects an in-flight registration after stop', async () => {
  const f = await setup()
  await f.watch(['7', '8'])
  await f.s.pipelineWatch.command({ taskId: f.taskId, action: 'stop', runIds: ['7'] })
  expect((await f.status()).watches.map((state) => state.status)).toEqual(['stopped', 'watching'])
  let resolve!: (value: ForgePipelineDetail & { cachedAt: string }) => void
  f.read.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const registration = f.watch(['9'])
  await f.s.pipelineWatch.command({ taskId: f.taskId, action: 'stop' })
  resolve(detail('9'))
  await expect(registration).rejects.toThrow('replaced or stopped')
  expect((await f.status()).watches).toHaveLength(2)
})

it('does not deliver an in-flight completion after its watch is stopped', async () => {
  const f = await setup()
  await f.watch()
  let resolve!: (value: ForgePipelineDetail & { cachedAt: string }) => void
  f.read.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const polling = f.s.pipelineWatch.tick()
  await f.s.pipelineWatch.command({ taskId: f.taskId, action: 'stop' })
  resolve(detail('7', 'success'))
  await polling
  expect(f.s.store.task(f.taskId).queue).toHaveLength(0)
})

it('retains watches on failed/stale reads and retries queue admission without duplicate delivery', async () => {
  const f = await setup()
  await f.watch()
  f.read.mockResolvedValue(detail('7', 'failure', { stale: true, refreshError: 'offline' }))
  await f.s.pipelineWatch.tick()
  expect(await f.status()).toMatchObject({ watches: [{ status: 'watching', error: 'offline' }] })
  expect(f.s.store.task(f.taskId).queue).toHaveLength(0)
  f.read.mockResolvedValue(detail('7', 'failure'))
  const admission = vi.spyOn(f.s.tasks.queue, 'add').mockImplementationOnce(() => {
    throw new Error('Queue is full')
  })
  await f.s.pipelineWatch.tick()
  expect(await f.status()).toMatchObject({
    watches: [{ status: 'watching', error: 'Queue is full' }],
  })
  admission.mockRestore()
  await f.s.pipelineWatch.tick()
  await f.s.pipelineWatch.tick()
  expect(f.s.store.task(f.taskId).queue).toHaveLength(1)
})

it('pauses on disable/read-only, removes watches on settlement, stops on project change and cleans deleted threads', async () => {
  const f = await setup()
  await f.watch()
  f.read.mockResolvedValue(detail('7', 'success'))
  f.s.preferences.save({ enablePipelineWatching: false })
  await f.s.pipelineWatch.tick()
  await expect(f.status()).rejects.toThrow('Enable the experimental pipeline watcher')
  f.s.preferences.save({ enablePipelineWatching: true })
  f.s.store.updateTask(f.taskId, (task) => ({ ...task, archived: true }))
  await f.s.pipelineWatch.tick()
  expect(f.s.store.task(f.taskId).queue).toHaveLength(0)
  expect(await f.status()).toEqual({ watches: [] })
  f.s.store.updateTask(f.taskId, (task) => ({ ...task, archived: false }))
  f.read.mockResolvedValue(detail())
  await f.watch()
  f.s.store.update((workspace) => ({
    ...workspace,
    agents: workspace.agents.map((agent) => ({ ...agent, permission: 'read-only' })),
  }))
  await f.s.pipelineWatch.tick()
  await expect(f.status()).rejects.toThrow('read-only')
  expect(f.s.store.task(f.taskId).queue).toHaveLength(0)
  f.s.store.update((workspace) => ({ ...workspace, agents: f.f.workspace.agents }))
  f.s.store.updateTask(f.taskId, (task) => ({ ...task, repositoryId: 'another' }))
  await f.s.pipelineWatch.tick()
  expect(await f.status()).toMatchObject({ watches: [{ status: 'stopped' }] })
  f.s.store.update((workspace) => ({ ...workspace, tasks: [] }))
  await f.s.pipelineWatch.tick()
  expect(f.s.db.prepare('SELECT * FROM task_pipeline_watches').all()).toEqual([])
})

it('persists watches and completion receipts across runtime restarts', async () => {
  const f = await setup(true)
  f.s.store.updateTask(f.taskId, (task) => ({ ...task, status: 'review' }))
  await f.watch(['7', '8'])
  expect(f.s.store.task(f.taskId).waitingForFeedback).toBe(true)
  await f.runtime.close()
  const restarted = await startRuntime({
    databasePath: join(f.f.directory, 'runtime.sqlite'),
    ownerToken: token,
    port: 0,
  })
  cleanups.push(() => restarted.close())
  expect(restarted.services.store.task(f.taskId).waitingForFeedback).toBe(true)
  vi.spyOn(restarted.services.forgeWork, 'request').mockImplementation(
    async (_repo, _operation, input) => detail(runId(input), 'failure'),
  )
  await restarted.services.pipelineWatch.tick()
  await restarted.services.pipelineWatch.tick()
  expect(restarted.services.store.task(f.taskId).queue).toHaveLength(2)
  expect(
    await restarted.services.pipelineWatch.command({ taskId: f.taskId, action: 'status' }),
  ).toMatchObject({ watches: [{ status: 'completed' }, { status: 'completed' }] })
})

it('requires explicit IDs, validates all registrations before saving, and bounds active runs', async () => {
  const f = await setup()
  await expect(f.s.pipelineWatch.command({ taskId: f.taskId, action: 'watch' })).rejects.toThrow(
    'Supply either a pipeline URL or run IDs',
  )
  f.read.mockResolvedValue(detail('wrong'))
  await expect(f.watch()).rejects.toThrow('identity changed')
  expect((await f.status()).watches).toHaveLength(0)
  f.read.mockImplementation(async (_repo, _operation, input) => detail(runId(input)))
  await f.watch(Array.from({ length: 20 }, (_, index) => String(index)))
  await expect(f.watch(['21'])).rejects.toThrow('at most 20')
  expect((await f.status()).watches).toHaveLength(20)
})

it('revives a waiting thread for a failed run through the normal task runner', async () => {
  const f = await setup()
  const run = vi.fn<AgentAdapter['run']>(async (input) => {
    input.onText('Handled completion')
  })
  vi.spyOn(f.s.agents, 'get').mockResolvedValue({ probe: vi.fn<AgentAdapter['probe']>(), run })
  f.s.store.updateTask(f.taskId, (task) => ({ ...task, status: 'review' }))
  await f.watch()
  expect(f.s.store.task(f.taskId).waitingForFeedback).toBe(true)
  f.s.store.updateTask(f.taskId, (task) => ({ ...task, queuePaused: false }))
  f.read.mockResolvedValue(detail('7', 'failure'))
  await f.s.pipelineWatch.tick()
  await vi.waitFor(() => expect(f.s.store.task(f.taskId).status).toBe('review'))
  expect(run).toHaveBeenCalledTimes(1)
  expect(f.s.store.task(f.taskId).waitingForFeedback).toBeUndefined()
  expect(
    f.s.store
      .task(f.taskId)
      .messages.some((message) => message.text.includes('Dovo pipeline completion')),
  ).toBe(true)
})

it('rolls back queue admission when persisting completion fails', async () => {
  const f = await setup()
  await f.watch()
  f.read.mockResolvedValue(detail('7', 'failure'))
  f.s.db.exec(`CREATE TRIGGER reject_pipeline_completion BEFORE INSERT ON task_pipeline_watches
    WHEN json_extract(NEW.value, '$.status') = 'completed'
    BEGIN SELECT RAISE(ABORT, 'completion save failed'); END`)
  await f.s.pipelineWatch.tick()
  expect(f.s.store.task(f.taskId).queue).toHaveLength(0)
  expect(await f.status()).toMatchObject({
    watches: [{ status: 'watching', error: 'completion save failed' }],
  })
  f.s.db.exec('DROP TRIGGER reject_pipeline_completion')
  await f.s.pipelineWatch.tick()
  expect(f.s.store.task(f.taskId).queue).toHaveLength(1)
})

it('finishes successful runs silently and keeps Waiting until the last watch ends', async () => {
  const f = await setup()
  f.s.store.updateTask(f.taskId, (task) => ({ ...task, status: 'review' }))
  await f.watch(['7', '8'])
  expect(f.s.store.task(f.taskId).waitingForFeedback).toBe(true)
  const send = vi.spyOn(f.s.tasks, 'send')
  f.read.mockImplementation(async (_repo, _operation, input) =>
    detail(runId(input), runId(input) === '7' ? 'success' : 'running'),
  )
  await f.s.pipelineWatch.tick()
  expect(f.s.store.task(f.taskId).waitingForFeedback).toBe(true)
  f.read.mockImplementation(async (_repo, _operation, input) => detail(runId(input), 'success'))
  await f.s.pipelineWatch.tick()
  expect(f.s.store.task(f.taskId).waitingForFeedback).toBeUndefined()
  expect(f.s.store.task(f.taskId).queue).toHaveLength(0)
  expect(send).not.toHaveBeenCalled()
})

it.each(['failure', 'startup_failure'])(
  'updates repeated registrations to returned %s without a later duplicate notification',
  async (status) => {
    const f = await setup()
    await f.watch()
    f.read.mockResolvedValue(detail('7', status))
    expect(await f.watch()).toMatchObject({
      watches: [{ status: 'completed', runStatus: status }],
    })
    await f.s.pipelineWatch.tick()
    expect(f.s.store.task(f.taskId).queue).toHaveLength(0)
  },
)

it('reports blocked or waiting runs once per transition and continues watching for completion', async () => {
  const f = await setup()
  await f.watch()
  for (const status of ['waiting', 'blocked', 'paused', 'running', 'waiting', 'failure']) {
    f.read.mockResolvedValue(detail('7', status))
    await f.s.pipelineWatch.tick()
    await f.s.pipelineWatch.tick()
  }
  const queue = f.s.store.task(f.taskId).queue ?? []
  expect(queue).toHaveLength(5)
  expect(queue[0]?.text).toContain('attention required')
  expect(queue[0]?.text).toContain('continues watching this run')
  expect(queue[4]?.text).toContain('This run watch is complete')
  expect(await f.status()).toMatchObject({ watches: [{ status: 'completed' }] })
})

it('baselines attention states returned at registration and ignores cancellation in progress', async () => {
  const f = await setup()
  f.read.mockResolvedValue(detail('7', 'waiting'))
  await f.watch()
  await f.s.pipelineWatch.tick()
  f.read.mockResolvedValue(detail('7', 'cancelling'))
  await f.s.pipelineWatch.tick()
  f.read.mockResolvedValue(detail('7', 'cancelled'))
  await f.s.pipelineWatch.tick()
  expect(f.s.store.task(f.taskId).queue).toHaveLength(0)
  expect(await f.status()).toMatchObject({ watches: [{ status: 'completed' }] })
})

it('isolates colliding run IDs across repositories and scopes stop/status without losing Waiting', async () => {
  const f = await linkedSetup()
  await Promise.all([f.watch(), f.linkedWatch()])
  expect((await f.status()).watches.map((state) => state.repositoryId).sort()).toEqual([
    'linked',
    'repo',
  ])
  await f.s.pipelineWatch.command({
    taskId: f.taskId,
    action: 'stop',
    repositoryId: 'repo',
    runIds: ['7'],
  })
  expect(
    await f.s.pipelineWatch.command({ taskId: f.taskId, action: 'status', repositoryId: 'linked' }),
  ).toMatchObject({ watches: [{ status: 'watching' }] })
  expect(f.s.store.task(f.taskId).waitingForFeedback).toBe(true)
  f.read.mockClear().mockResolvedValue(detail('7', 'failure'))
  await f.s.pipelineWatch.tick()
  expect(f.read).toHaveBeenCalledTimes(1)
  expect(f.read).toHaveBeenCalledWith(
    'linked',
    'pipelines/detail',
    { id: '7', refresh: true },
    true,
  )
  expect(f.s.store.task(f.taskId).queue).toHaveLength(1)
  await expect(
    f.s.pipelineWatch.command({
      taskId: f.taskId,
      action: 'watch',
      repositoryId: 'unrelated',
      runIds: ['7'],
    }),
  ).rejects.toMatchObject({ status: 403 })
})

it('preserves non-overlapping registrations and only cancels selected pending runs', async () => {
  const f = await setup()
  const releases = new Map<string, (value: ReturnType<typeof detail>) => void>()
  f.read.mockImplementation(
    (_repo, _operation, input) =>
      new Promise<ReturnType<typeof detail>>((resolve) => releases.set(runId(input), resolve)),
  )
  const first = f.watch(['7'])
  const second = f.watch(['8'])
  await f.s.pipelineWatch.command({ taskId: f.taskId, action: 'stop', runIds: ['7'] })
  releases.get('7')?.(detail('7'))
  releases.get('8')?.(detail('8'))
  await expect(first).rejects.toThrow('replaced or stopped')
  await second
  expect(await f.status()).toMatchObject({ watches: [{ runId: '8', status: 'watching' }] })
})

it('discards an older in-flight completion after explicit registration of a rerun', async () => {
  const f = await setup()
  const attempt = (number: number, status: string) => ({
    ...detail('7', status),
    run: { ...detail('7', status).run, attempt: number },
  })
  f.read.mockResolvedValue(attempt(1, 'running'))
  await f.watch()
  let release!: (value: ReturnType<typeof detail>) => void
  f.read.mockImplementationOnce(
    () =>
      new Promise<ReturnType<typeof detail>>((resolve) => {
        release = resolve
      }),
  )
  const polling = f.s.pipelineWatch.tick()
  f.read.mockResolvedValue(attempt(2, 'running'))
  await f.watch()
  release(attempt(1, 'failure'))
  await polling
  expect(f.s.store.task(f.taskId).queue).toHaveLength(0)
  expect(await f.status()).toMatchObject({ watches: [{ status: 'watching', attempt: 2 }] })
  f.read.mockResolvedValue(attempt(1, 'failure'))
  await f.s.pipelineWatch.tick()
  expect(await f.status()).toMatchObject({
    watches: [
      { status: 'watching', attempt: 2, error: 'Waiting for the current pipeline attempt' },
    ],
  })
  f.read.mockResolvedValue(attempt(2, 'failure'))
  await f.s.pipelineWatch.tick()
  await f.s.pipelineWatch.tick()
  expect(f.s.store.task(f.taskId).queue).toHaveLength(1)
  expect(f.s.store.task(f.taskId).queue?.[0]?.text).toContain('Attempt: 2')
})

it('prioritizes failed jobs and includes failed step diagnostics in bounded feedback', async () => {
  const f = await setup()
  await f.watch()
  const jobs = Array.from({ length: 30 }, (_, index) => ({
    id: String(index),
    name: `Passed ${index}`,
    status: 'success',
    url: detail().run.url,
  }))
  jobs.push({ id: 'failed', name: 'Failing build', status: 'failure', url: detail().run.url })
  f.read.mockResolvedValue(
    detail('7', 'failure', {
      jobs: jobs.map((job) =>
        job.id === 'failed'
          ? {
              ...job,
              steps: [
                {
                  id: 'compile',
                  name: 'Compile',
                  status: 'failure',
                  errors: ['Type error in app.ts'],
                },
              ],
            }
          : job,
      ),
    }),
  )
  await f.s.pipelineWatch.tick()
  const text = f.s.store.task(f.taskId).queue?.[0]?.text ?? ''
  expect(text).toContain('Failing build')
  expect(text).toContain('Type error in app.ts')
  expect(text).toContain('Partial job context')
  expect(text.length).toBeLessThan(20000)
})

it('migrates legacy pipeline watches without losing active runs', async () => {
  const f = await setup()
  await f.watch()
  f.s.db.exec(`ALTER TABLE task_pipeline_watches RENAME TO task_pipeline_watches_new;
    CREATE TABLE task_pipeline_watches (task_id TEXT NOT NULL, run_id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (task_id, run_id));
    INSERT INTO task_pipeline_watches SELECT task_id, run_id, json_remove(value, '$.primaryRepositoryId', '$.attempt', '$.notifiedStatus') FROM task_pipeline_watches_new;
    DROP TABLE task_pipeline_watches_new;`)
  const watcher = new PipelineWatch(f.s.db, f.s)
  f.read.mockResolvedValue(detail('7', 'failure'))
  await watcher.tick()
  await watcher.tick()
  expect(f.s.store.task(f.taskId).queue).toHaveLength(1)
  expect(await f.status()).toMatchObject({
    watches: [{ repositoryId: 'repo', status: 'completed' }],
  })
})

it('shares a fresh pipeline read across threads watching the same run', async () => {
  const f = await setup()
  const other = f.s.tasks.create({
    title: 'Other',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  f.s.store.updateTask(other.id, (task) => ({ ...task, queuePaused: true }))
  await f.watch()
  await f.s.pipelineWatch.command({ taskId: other.id, action: 'watch', runIds: ['7'] })
  f.read.mockClear().mockResolvedValue(detail('7', 'failure'))
  await f.s.pipelineWatch.tick()
  expect(f.read).toHaveBeenCalledTimes(1)
  expect(f.s.store.task(f.taskId).queue).toHaveLength(1)
  expect(f.s.store.task(other.id).queue).toHaveLength(1)
})

it('rejects a registration whose agent turn retires during its forge read', async () => {
  const f = await setup()
  let release!: (value: ReturnType<typeof detail>) => void
  f.read.mockImplementation(
    () =>
      new Promise<ReturnType<typeof detail>>((resolve) => {
        release = resolve
      }),
  )
  let registration: ReturnType<typeof f.s.pipelineWatch.command> | undefined
  vi.spyOn(f.s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async () => {
      registration = f.s.pipelineWatch.command({
        taskId: f.taskId,
        parentRunId: f.s.store.task(f.taskId).activeRunId,
        action: 'watch',
        runIds: ['7'],
      })
    },
  })
  f.s.tasks.queue.add(f.taskId, 'initial', 'Watch the run')
  await (
    await f.s.tasks.start(f.taskId, true)
  ).done
  if (!registration) throw new Error('Expected an in-flight registration')
  release(detail())
  await expect(registration).rejects.toThrow('parent turn has ended')
  expect(await f.status()).toEqual({ watches: [] })
})

it('lets paired devices inspect and selectively unlink waiting runs while preserving other watches', async () => {
  const f = await setup()
  const phone = 'waiting-panel-phone-token-at-least-32-characters'
  f.s.devices.add('Phone', phone)
  f.s.store.updateTask(f.taskId, (task) => ({ ...task, status: 'review' }))
  await f.watch(['7', '8'])
  const origin = `http://127.0.0.1:${f.runtime.port}`
  const request = (input: unknown, bearer = phone) =>
    fetch(origin + '/api/tasks/waiting', {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  const { taskWaitingSchema } = await import('@dovo/protocol')
  const first = await request({ taskId: f.taskId })
  expect(first.status).toBe(200)
  expect(decode(taskWaitingSchema, await first.json()).dependencies).toMatchObject([
    { kind: 'pipeline', target: '7', status: 'in_progress' },
    { kind: 'pipeline', target: '8', status: 'in_progress' },
  ])
  expect((await request({ taskId: f.taskId }, 'invalid')).status).toBe(401)
  expect((await request({ taskId: f.taskId, unlink: { kind: 'pipeline' } })).status).toBe(400)
  f.s.preferences.save({ enablePipelineWatching: false })
  const unlink = (target: string) =>
    request({ taskId: f.taskId, unlink: { kind: 'pipeline', repositoryId: 'repo', target } })
  const stopped = await unlink('7')
  expect(stopped.status).toBe(200)
  expect(
    decode(taskWaitingSchema, await stopped.json()).dependencies.map((item) => item.target),
  ).toEqual(['8'])
  expect(f.s.store.task(f.taskId).waitingForFeedback).toBeUndefined()
  expect((await unlink('8')).status).toBe(200)
  expect(f.s.store.task(f.taskId).waitingForFeedback).toBeUndefined()
  expect((await unlink('8')).status).toBe(200)
})

it.each(['job', 'step'])(
  'ends the watch and wakes the thread on an early %s failure',
  async (part) => {
    const f = await setup()
    f.s.store.updateTask(f.taskId, (task) => ({ ...task, status: 'review' }))
    await f.watch()
    f.read.mockResolvedValue(
      detail('7', 'in_progress', {
        jobs: [
          {
            id: 'build',
            name: 'Build',
            url: detail().run.url,
            status: part === 'job' ? 'failure' : 'in_progress',
            steps: [
              { id: 'compile', name: 'Compile', status: 'failure', errors: ['Compilation failed'] },
            ],
          },
        ],
      }),
    )
    await f.s.pipelineWatch.tick()
    await f.s.pipelineWatch.tick()
    expect(await f.status()).toMatchObject({
      watches: [{ status: 'completed', runStatus: 'in_progress' }],
    })
    expect(f.s.store.task(f.taskId).waitingForFeedback).toBeUndefined()
    expect(f.s.store.task(f.taskId).queue).toHaveLength(1)
    expect(f.s.store.task(f.taskId).queue?.[0]?.text).toContain('Compilation failed')
    expect(f.s.pipelineWatch.counts(f.taskId)).toEqual({ active: 0, failures: 1 })
    expect(new PipelineWatch(f.s.db, f.s).counts(f.taskId)).toEqual({ active: 0, failures: 1 })
    expect(f.s.store.taskSummary(f.taskId).watchCounts?.failures).toBe(1)
    f.read.mockResolvedValue(detail('7', 'in_progress'))
    await f.watch()
    expect(f.s.pipelineWatch.counts(f.taskId)).toEqual({ active: 1, failures: 0 })
  },
)

it('returns and finishes an already failed part at registration without duplicate delivery', async () => {
  const f = await setup()
  f.read.mockResolvedValue(
    detail('7', 'running', {
      jobs: [{ id: 'build', name: 'Build', url: detail().run.url, status: 'failure' }],
    }),
  )
  expect(await f.watch()).toMatchObject({ watches: [{ status: 'completed' }] })
  await f.s.pipelineWatch.tick()
  expect(f.s.store.task(f.taskId).queue).toHaveLength(0)
})

it('reads all job pages for registration and detects early failures beyond the first page', async () => {
  const f = await setup()
  const querySchema = mutableStruct({ id: Schema.String, cursor: Schema.optional(Schema.String) })
  const passed = Array.from({ length: 50 }, (_, index) => ({
    id: String(index),
    name: `Passed ${index}`,
    status: 'success',
    url: detail().run.url,
  }))
  let failed = false
  f.read.mockImplementation(async (_repo, _operation, input) => {
    const query = decode(querySchema, input)
    if (!query.cursor) return detail(query.id, 'running', { jobs: passed, next: '2' })
    if (query.cursor === '2')
      return detail(query.id, 'running', {
        jobs: [
          {
            id: '50',
            name: 'Late build',
            status: failed ? 'failure' : 'running',
            url: detail().run.url,
          },
        ],
        next: '3',
      })
    return detail(query.id, 'running', {
      jobs: [{ id: '51', name: 'Last build', status: 'running', url: detail().run.url }],
    })
  })
  expect(await f.watch()).toMatchObject({
    runs: [
      {
        jobs: expect.arrayContaining([
          { id: '51', name: 'Last build', status: 'running', url: detail().run.url },
        ]),
      },
    ],
  })
  expect(f.read).toHaveBeenCalledWith(
    'repo',
    'pipelines/detail',
    {
      id: '7',
      cursor: '3',
      refresh: true,
    },
    false,
  )
  failed = true
  await f.s.pipelineWatch.tick()
  await f.s.pipelineWatch.tick()
  expect(await f.status()).toMatchObject({ watches: [{ status: 'completed' }] })
  expect(f.s.store.task(f.taskId).queue).toHaveLength(1)
  expect(f.s.store.task(f.taskId).queue?.[0]?.text).toContain('Late build: failure')
})

it.each(['stale', 'changed-attempt', 'repeated-cursor'])(
  'retains a watch when job pagination is %s',
  async (problem) => {
    const f = await setup()
    await f.watch()
    f.read.mockImplementation(async (_repo, _operation, input) => {
      const query = decode(mutableStruct({ cursor: Schema.optional(Schema.String) }), input)
      if (!query.cursor) return detail('7', 'running', { next: '2' })
      if (problem === 'stale')
        return detail('7', 'success', { stale: true, refreshError: 'Jobs unavailable' })
      if (problem === 'changed-attempt')
        return { ...detail('7', 'success'), run: { ...detail().run, attempt: 2 } }
      return detail('7', 'running', { next: '2' })
    })
    await f.s.pipelineWatch.tick()
    expect(await f.status()).toMatchObject({
      watches: [{ status: 'watching', error: expect.any(String) }],
    })
    expect(f.s.store.task(f.taskId).queue).toHaveLength(0)
    expect(f.read).toHaveBeenCalledTimes(3)
  },
)

it('shows retained pipeline watches as paused and restores Waiting immediately on re-enable', async () => {
  const f = await setup()
  const { taskWaiting } = await import('../../http/endpoints/task-waiting.js')
  f.s.store.updateTask(f.taskId, (task) => ({ ...task, status: 'review' }))
  await f.watch()
  expect(f.s.store.task(f.taskId).waitingForFeedback).toBe(true)
  f.s.preferences.save({ enablePipelineWatching: false })
  expect(f.s.store.task(f.taskId).waitingForFeedback).toBeUndefined()
  expect(await taskWaiting(f.s, { taskId: f.taskId })).toMatchObject({
    dependencies: [
      { target: '7', pausedReason: 'Monitoring paused: watcher disabled in runtime settings' },
    ],
  })
  f.s.preferences.save({ enablePipelineWatching: true })
  expect(f.s.store.task(f.taskId).waitingForFeedback).toBe(true)
  expect(
    (await taskWaiting(f.s, { taskId: f.taskId })).dependencies[0]?.pausedReason,
  ).toBeUndefined()
  f.s.store.updateTask(f.taskId, (task) => ({ ...task, status: 'running' }))
  expect(f.s.store.task(f.taskId).waitingForFeedback).toBeUndefined()
  expect((await taskWaiting(f.s, { taskId: f.taskId })).dependencies).toHaveLength(1)
})

it('shows read-only monitoring as paused without leaving the thread in Waiting', async () => {
  const f = await setup()
  const { taskWaiting } = await import('../../http/endpoints/task-waiting.js')
  f.s.store.updateTask(f.taskId, (task) => ({ ...task, status: 'review' }))
  await f.watch()
  f.s.store.update((workspace) => ({
    ...workspace,
    agents: workspace.agents.map((agent) => ({ ...agent, permission: 'read-only' })),
  }))
  expect(f.s.store.task(f.taskId).waitingForFeedback).toBeUndefined()
  expect((await taskWaiting(f.s, { taskId: f.taskId })).dependencies[0]?.pausedReason).toContain(
    'read-only',
  )
  f.s.store.update((workspace) => ({ ...workspace, agents: f.f.workspace.agents }))
  expect(f.s.store.task(f.taskId).waitingForFeedback).toBe(true)
})

it('polls with background quota and retains last success when a later poll fails', async () => {
  const f = await setup()
  await f.watch()
  const registered = (await f.status()).watches[0]!
  expect(registered.lastSuccessAt).toBe(registered.checkedAt)
  f.read.mockClear()
  await f.s.pipelineWatch.tick()
  expect(f.read).toHaveBeenCalledWith('repo', 'pipelines/detail', { id: '7', refresh: true }, true)
  const success = (await f.status()).watches[0]!
  f.read.mockRejectedValue(new Error('Background quota reserved for interactive work'))
  await f.s.pipelineWatch.tick()
  const failed = (await f.status()).watches[0]!
  expect(failed.error).toContain('quota reserved')
  expect(failed.lastSuccessAt).toBe(success.lastSuccessAt)
  f.read.mockResolvedValue(detail())
  await f.s.pipelineWatch.tick()
  expect((await f.status()).watches[0]!.error).toBeUndefined()
})

it('lets spawned children own pipeline watches and rolls counts up without delivering to the parent', async () => {
  const f = await setup()
  const parent = f.s.tasks.create({
    title: 'Parent',
    agentId: 'agent',
    repositoryId: 'repo',
    objective: '',
  })
  f.s.store.updateTask(parent.id, (task) => ({ ...task, status: 'review', queuePaused: true }))
  f.s.store.updateTask(f.taskId, (task) => ({
    ...task,
    status: 'review',
    delegation: {
      parentTaskId: parent.id,
      parentRunId: 'previous-run',
      completion: 'read',
      key: 'ci',
    },
  }))
  await f.watch()
  expect(f.s.store.taskSummary(parent.id).watchCounts?.pipelines).toBe(1)
  expect(f.s.store.taskSummary(parent.id).waitingForFeedback).toBe(true)
  f.read.mockResolvedValue(detail('7', 'failure'))
  await f.s.pipelineWatch.tick()
  expect(f.s.store.taskSummary(f.taskId).queue).toHaveLength(1)
  expect(f.s.store.taskSummary(parent.id).queue ?? []).toHaveLength(0)
  expect(f.s.store.taskSummary(parent.id).watchCounts).toMatchObject({ pipelines: 0, failures: 1 })
})
