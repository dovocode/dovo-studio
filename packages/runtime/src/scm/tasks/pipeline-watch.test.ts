import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { Schema } from 'effect'
import { decode, mutableStruct } from '@dovo/protocol'
import type { AgentAdapter } from '../../agents/execution/types.js'
import type { ForgePipelineDetail } from '@dovo/protocol'
import { startRuntime } from '../../index.js'
import { fixture } from '../../testing/fixture.js'

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

it('adds explicit runs, preserves existing watches and delivers each completion once without unpausing', async () => {
  const f = await setup()
  await f.watch(['7', '8'])
  await f.watch(['9'])
  await f.watch(['7'])
  expect((await f.status()).watches).toHaveLength(3)
  expect(f.read).toHaveBeenCalledWith('repo', 'pipelines/detail', { id: '7', refresh: true })
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
    'Run IDs are required',
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
