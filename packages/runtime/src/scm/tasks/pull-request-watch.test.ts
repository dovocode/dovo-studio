import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import type { PullComment, PullDetail } from '@dovo/protocol'
import type { AgentAdapter } from '../../agents/execution/types.js'
import { startRuntime } from '../../index.js'
import { fixture } from '../../testing/fixture.js'
import { PullRequestWatch } from './pull-request-watch.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.restoreAllMocks()
})
const url = 'https://github.com/team/project/pull/7'
const token = 'pr-watch-test-owner-token-at-least-32-characters'
const comment = (id: string, extra: Partial<PullComment> = {}): PullComment => ({
  id,
  kind: 'comment',
  author: 'reviewer',
  body: `Feedback ${id}`,
  date: '2026-10-07T12:00:00Z',
  url: `${url}#${id}`,
  ...extra,
})
const detail = (extra: Partial<PullDetail> = {}): PullDetail => ({
  pull: {
    number: 7,
    title: 'Fix',
    url,
    state: 'open',
    draft: false,
    author: 'author',
    updatedAt: '2026-10-07T10:00:00Z',
    head: 'fix',
    base: 'main',
    labels: [],
    repositoryUrl: 'https://github.com/team/project',
    headSha: 'a'.repeat(40),
    baseSha: 'b'.repeat(40),
    body: '',
    additions: 1,
    deletions: 1,
    changedFiles: 1,
    mergeable: true,
    reviewers: [],
    assignees: [],
  },
  comments: [comment('old')],
  checks: [],
  files: [],
  warnings: [],
  ...extra,
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
  s.preferences.save({ enablePullRequestWatching: true })
  const read = vi.spyOn(s.pullCache, 'feedback').mockResolvedValue(detail())
  const watch = (watchUrl = url) =>
    s.pullRequestWatch.command({ taskId: task.id, action: 'watch', url: watchUrl })
  const status = () => s.pullRequestWatch.command({ taskId: task.id, action: 'status' })
  return { f, runtime, s, taskId: task.id, read, watch, status }
}

it('baselines old feedback, returns existing failures, delivers every feedback kind once and preserves a paused queue', async () => {
  const f = await setup()
  const existingFailure = { id: 'check-old', name: 'lint', status: 'failure' }
  f.read.mockResolvedValue(detail({ checks: [existingFailure] }))
  expect(await f.watch()).toMatchObject({
    watch: { status: 'watching' },
    failedChecks: [existingFailure],
  })
  await f.s.pullRequestWatch.tick()
  expect(f.s.store.task(f.taskId).queue).toHaveLength(0)
  f.read.mockResolvedValue(
    detail({
      comments: [
        comment('old'),
        comment('new'),
        comment('review', { kind: 'review', body: '', state: 'CHANGES_REQUESTED' }),
        comment('inline', { kind: 'inline', path: 'app.ts', line: 12 }),
      ],
      checks: [
        existingFailure,
        { id: 'test-1', name: 'tests', status: 'failure', summary: 'Assertion failed' },
      ],
    }),
  )
  // Idempotent registration must not consume feedback that arrived since the first call.
  await f.watch()
  await f.s.pullRequestWatch.tick()
  const queued = f.s.store.task(f.taskId).queue ?? []
  expect(queued).toHaveLength(1)
  expect(queued[0]?.text).toContain('Feedback new')
  expect(queued[0]?.text).toContain('CHANGES_REQUESTED')
  expect(queued[0]?.text).toContain('app.ts:12')
  expect(queued[0]?.text).toContain('Failed check: tests')
  expect(queued[0]?.text).not.toContain('Feedback old')
  expect(queued[0]?.text).not.toContain('Failed check: lint')
  expect(f.s.store.task(f.taskId).queuePaused).toBe(true)
  await f.s.pullRequestWatch.tick()
  expect(f.s.store.task(f.taskId).queue).toHaveLength(1)
})

it('wakes an idle harness and queues feedback behind an active turn without interrupting it', async () => {
  const f = await setup()
  const prompts: string[] = []
  let finishFirst: () => void = () => {
    throw new Error('The first turn has not started')
  }
  const firstFinished = new Promise<void>((resolve) => {
    finishFirst = resolve
  })
  vi.spyOn(f.s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      prompts.push(run.prompt)
      if (prompts.length === 1)
        await Promise.race([
          firstFinished,
          new Promise<void>((resolve) =>
            run.signal.addEventListener('abort', () => resolve(), { once: true }),
          ),
        ])
      run.onText('Reviewed feedback')
    },
  })
  await f.watch()
  f.s.store.updateTask(f.taskId, (task) => ({ ...task, queuePaused: false }))
  f.read.mockResolvedValue(detail({ comments: [comment('new')] }))
  await f.s.pullRequestWatch.tick()
  await vi.waitFor(() => expect(prompts).toHaveLength(1))
  expect(prompts[0]).toContain('Feedback new')
  expect(f.s.store.task(f.taskId).status).toBe('running')
  f.read.mockResolvedValue(detail({ comments: [comment('new'), comment('next')] }))
  await f.s.pullRequestWatch.tick()
  expect(prompts).toHaveLength(1)
  expect(f.s.store.task(f.taskId).queue).toHaveLength(1)
  finishFirst()
  await vi.waitFor(() => expect(prompts).toHaveLength(2))
  await vi.waitFor(() => expect(f.s.store.task(f.taskId).status).toBe('review'))
  expect(prompts[1]).toContain('Feedback next')
  expect(f.s.store.task(f.taskId).queue).toHaveLength(0)
})

it('does not wake for pending/passing checks, but delivers a rerun or a newly failing head', async () => {
  const f = await setup()
  await f.watch()
  const check = { id: '1', name: 'tests', status: 'pending' }
  f.read.mockResolvedValue(detail({ checks: [check] }))
  await f.s.pullRequestWatch.tick()
  check.status = 'failure'
  await f.s.pullRequestWatch.tick()
  expect(f.s.store.task(f.taskId).queue).toHaveLength(1)
  await f.s.pullRequestWatch.tick()
  expect(f.s.store.task(f.taskId).queue).toHaveLength(1)
  check.status = 'success'
  await f.s.pullRequestWatch.tick()
  check.status = 'failure'
  await f.s.pullRequestWatch.tick()
  expect(f.s.store.task(f.taskId).queue).toHaveLength(2)
  f.read.mockResolvedValue(detail({ checks: [{ ...check, id: '2' }] }))
  await f.s.pullRequestWatch.tick()
  expect(f.s.store.task(f.taskId).queue).toHaveLength(3)
  f.read.mockResolvedValue(
    detail({
      pull: { ...detail().pull, headSha: 'c'.repeat(40) },
      checks: [{ ...check, id: '2' }],
    }),
  )
  await f.s.pullRequestWatch.tick()
  expect(f.s.store.task(f.taskId).queue).toHaveLength(4)
})

it('retains progress through unavailable sections, stale results and a full queue', async () => {
  const f = await setup()
  await f.watch()
  f.read.mockResolvedValue(detail({ comments: [comment('new')], stale: true }))
  await f.s.pullRequestWatch.tick()
  expect(f.s.store.task(f.taskId).queue).toHaveLength(0)
  f.read.mockResolvedValue(
    detail({ comments: [comment('new')], warnings: ['Conversation: offline'] }),
  )
  await f.s.pullRequestWatch.tick()
  expect(f.s.store.task(f.taskId).queue).toHaveLength(0)
  expect(await f.status()).toMatchObject({ watch: { error: 'Conversation: offline' } })
  f.read.mockResolvedValue(detail({ comments: [comment('new')] }))
  f.s.store.updateTask(f.taskId, (task) => ({
    ...task,
    queue: Array.from({ length: 50 }, (_, i) => ({
      id: `full-${i}`,
      role: 'user' as const,
      text: 'Existing input',
      createdAt: new Date().toISOString(),
    })),
  }))
  await f.s.pullRequestWatch.tick()
  expect(await f.status()).toMatchObject({
    watch: { error: expect.stringContaining('Queue is full') },
  })
  f.s.store.updateTask(f.taskId, (task) => ({ ...task, queue: [] }))
  await f.s.pullRequestWatch.tick()
  expect(f.s.store.task(f.taskId).queue).toHaveLength(1)
  await f.s.pullRequestWatch.tick()
  expect(f.s.store.task(f.taskId).queue).toHaveLength(1)
})

it('survives a runtime restart without replaying delivered feedback', async () => {
  const f = await setup(true)
  await f.watch()
  f.read.mockResolvedValue(detail({ comments: [comment('new')] }))
  await f.s.pullRequestWatch.tick()
  await f.runtime.close()
  cleanups.pop()
  const restarted = await startRuntime({
    databasePath: join(f.f.directory, 'runtime.sqlite'),
    ownerToken: token,
    port: 0,
  })
  cleanups.push(() => restarted.close())
  const read = vi
    .spyOn(restarted.services.pullCache, 'feedback')
    .mockResolvedValue(detail({ comments: [comment('new')] }))
  await restarted.services.pullRequestWatch.tick()
  expect(restarted.services.store.task(f.taskId).queue).toHaveLength(1)
  read.mockResolvedValue(detail({ comments: [comment('new'), comment('after-restart')] }))
  await restarted.services.pullRequestWatch.tick()
  expect(restarted.services.store.task(f.taskId).queue).toHaveLength(2)
  expect(restarted.services.store.task(f.taskId).queuePaused).toBe(true)
})

it('pauses disabled/archived/read-only threads, stops on closure or project change and cleans deleted threads', async () => {
  const f = await setup()
  await f.watch()
  f.read.mockClear().mockResolvedValue(detail({ comments: [comment('new')] }))
  f.s.preferences.save({ enablePullRequestWatching: false })
  await f.s.pullRequestWatch.tick()
  await expect(f.status()).rejects.toMatchObject({ status: 403 })
  expect(f.read).not.toHaveBeenCalled()
  f.s.preferences.save({ enablePullRequestWatching: true })
  f.s.store.updateTask(f.taskId, (task) => ({ ...task, archived: true }))
  await f.s.pullRequestWatch.tick()
  expect(f.read).not.toHaveBeenCalled()
  expect(await f.status()).toEqual({ watch: null })
  f.s.store.updateTask(f.taskId, (task) => ({ ...task, archived: false }))
  f.read.mockResolvedValue(detail())
  await f.watch()
  f.read.mockClear()
  f.s.store.update((workspace) => ({
    ...workspace,
    agents: workspace.agents.map((agent) => ({ ...agent, permission: 'read-only' })),
  }))
  await f.s.pullRequestWatch.tick()
  await expect(f.watch()).rejects.toMatchObject({ status: 403 })
  expect(f.read).not.toHaveBeenCalled()
  f.s.store.update((workspace) => ({
    ...workspace,
    agents: workspace.agents.map((agent) => ({ ...agent, permission: 'ask' })),
  }))
  f.read.mockResolvedValue(
    detail({ pull: { ...detail().pull, state: 'merged' }, comments: [comment('new')] }),
  )
  await f.s.pullRequestWatch.tick()
  expect(await f.status()).toMatchObject({ watch: { status: 'closed' } })
  expect(f.s.store.task(f.taskId).queue).toHaveLength(1)
  f.read.mockClear()
  await f.s.pullRequestWatch.tick()
  expect(f.read).not.toHaveBeenCalled()
  f.read.mockResolvedValue(detail())
  await f.watch()
  f.s.store.updateTask(f.taskId, (task) => ({ ...task, repositoryId: 'other' }))
  await f.s.pullRequestWatch.tick()
  expect(await f.status()).toMatchObject({
    watch: { status: 'stopped', error: 'The thread’s project changed' },
  })
  f.s.store.update((workspace) => ({ ...workspace, tasks: [] }))
  await f.s.pullRequestWatch.tick()
  expect(f.s.db.prepare('SELECT * FROM task_pull_watches').all()).toEqual([])
})

it('rejects foreign URLs and incomplete baselines, and cancels in-flight registration/polling', async () => {
  const f = await setup()
  await expect(f.watch('https://github.com/foreign/project/pull/7')).rejects.toThrow(
    'different project',
  )
  f.read.mockResolvedValue(detail({ warnings: ['Inline comments: permission denied'] }))
  await expect(f.watch()).rejects.toMatchObject({ status: 503 })
  let resolveRead: (value: PullDetail) => void = () => {
    throw new Error('Not waiting')
  }
  f.read.mockImplementation(
    () =>
      new Promise<PullDetail>((resolve) => {
        resolveRead = resolve
      }),
  )
  const registering = f.watch()
  await f.s.pullRequestWatch.command({ taskId: f.taskId, action: 'stop' })
  resolveRead(detail())
  await expect(registering).rejects.toMatchObject({ status: 409 })
  f.read.mockResolvedValue(detail())
  await f.watch()
  f.read.mockImplementation(
    () =>
      new Promise<PullDetail>((resolve) => {
        resolveRead = resolve
      }),
  )
  const polling = f.s.pullRequestWatch.tick()
  await f.s.pullRequestWatch.command({ taskId: f.taskId, action: 'stop' })
  resolveRead(detail({ comments: [comment('new')] }))
  await polling
  expect(f.s.store.task(f.taskId).queue).toHaveLength(0)
  expect(await f.status()).toMatchObject({ watch: { status: 'stopped' } })
})

it('drains large batches without dropping comments and ignores unsubmitted reviews', async () => {
  const f = await setup()
  f.read.mockResolvedValue(
    detail({ comments: [comment('pending', { kind: 'review', state: 'PENDING', date: '' })] }),
  )
  await f.watch()
  const comments = Array.from({ length: 12 }, (_, i) =>
    comment(String(i), { body: `${i}: ${'x'.repeat(6000)}` }),
  )
  f.read.mockResolvedValue(
    detail({
      comments: [...comments, comment('pending', { kind: 'review', state: 'PENDING', date: '' })],
    }),
  )
  for (let i = 0; i < 5; i++) await f.s.pullRequestWatch.tick()
  const queue = f.s.store.task(f.taskId).queue ?? []
  expect(queue).toHaveLength(4)
  expect(queue.every((message) => message.text.length <= 20000)).toBe(true)
  for (const comment of comments)
    expect(queue.filter((message) => message.text.includes(`${comment.url}\n`))).toHaveLength(1)
  f.read.mockResolvedValue(
    detail({ comments: [...comments, comment('pending', { kind: 'review', state: 'COMMENTED' })] }),
  )
  await f.s.pullRequestWatch.tick()
  expect(f.s.store.task(f.taskId).queue).toHaveLength(5)
})

it('polls on the runtime schedule, not on agent turns, and stops when disposed', async () => {
  const f = await setup()
  await f.watch()
  const watcher = new PullRequestWatch(f.s.db, f.s)
  vi.useFakeTimers()
  try {
    f.read.mockClear()
    watcher.start()
    await vi.advanceTimersByTimeAsync(119999)
    expect(f.read).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => expect(f.read).toHaveBeenCalledTimes(1))
    await watcher.dispose()
    await vi.advanceTimersByTimeAsync(120000)
    expect(f.read).toHaveBeenCalledTimes(1)
  } finally {
    await watcher.dispose()
    vi.useRealTimers()
  }
})

it('revives Waiting for PR feedback and returns to Waiting after the agent handles it', async () => {
  const f = await setup()
  const run = vi.fn<AgentAdapter['run']>(async (input) => {
    input.onText('Handled feedback')
  })
  vi.spyOn(f.s.agents, 'get').mockResolvedValue({ probe: vi.fn<AgentAdapter['probe']>(), run })
  f.s.store.updateTask(f.taskId, (task) => ({ ...task, status: 'review', queuePaused: false }))
  await f.watch()
  expect(f.s.store.task(f.taskId).waitingForFeedback).toBe(true)
  f.read.mockResolvedValue(detail({ comments: [comment('old'), comment('new')] }))
  await f.s.pullRequestWatch.tick()
  await vi.waitFor(() => expect(f.s.store.task(f.taskId).waitingForFeedback).toBe(true))
  expect(run).toHaveBeenCalledTimes(1)
  expect(f.s.store.task(f.taskId).status).toBe('review')
  expect(f.s.store.task(f.taskId).queue).toHaveLength(0)
  await f.s.pullRequestWatch.command({ taskId: f.taskId, action: 'stop' })
  expect(f.s.store.task(f.taskId).waitingForFeedback).toBeUndefined()
})

it.each(['settle', 'archive'] as const)(
  'removes both PR and pipeline watches on %s without restoring them',
  async (action) => {
    const f = await setup()
    f.s.store.updateTask(f.taskId, (task) => ({ ...task, status: 'review' }))
    await f.watch()
    f.s.preferences.save({ enablePipelineWatching: true })
    vi.spyOn(f.s.forgeWork, 'request').mockResolvedValue({
      run: {
        id: '7',
        title: 'Build',
        url: 'https://github.com/team/project/actions/runs/7',
        ref: 'main',
        sha: 'a'.repeat(40),
        actor: 'author',
        status: 'running',
        createdAt: '',
        updatedAt: '',
      },
      jobs: [],
      cachedAt: new Date().toISOString(),
    })
    await f.s.pipelineWatch.command({ taskId: f.taskId, action: 'watch', runIds: ['7'] })
    f.s.store.patch({
      collection: 'tasks',
      id: f.taskId,
      changes: { archived: { before: undefined, after: true } },
    })
    if (action === 'archive')
      f.s.store.updateTask(f.taskId, (task) => ({ ...task, archivedAt: new Date().toISOString() }))
    expect(await f.status()).toEqual({ watch: null })
    expect(await f.s.pipelineWatch.command({ taskId: f.taskId, action: 'status' })).toEqual({
      watches: [],
    })
    expect(f.s.store.task(f.taskId).waitingForFeedback).toBeUndefined()
    f.s.store.updateTask(f.taskId, (task) => ({ ...task, archived: false, archivedAt: undefined }))
    expect(await f.status()).toEqual({ watch: null })
    f.read.mockResolvedValue(detail({ comments: [comment('new')] }))
    await f.s.pullRequestWatch.tick()
    await f.s.pipelineWatch.tick()
    expect(f.s.store.task(f.taskId).queue).toHaveLength(0)
  },
)

it('keeps Waiting for a pipeline after the PR watcher ends, and cancels registrations during settlement', async () => {
  const f = await setup()
  f.s.store.updateTask(f.taskId, (task) => ({ ...task, status: 'review' }))
  await f.watch()
  f.s.preferences.save({ enablePipelineWatching: true })
  vi.spyOn(f.s.forgeWork, 'request').mockResolvedValue({
    run: {
      id: '7',
      title: 'Build',
      url: 'https://github.com/team/project/actions/runs/7',
      ref: 'main',
      sha: 'a'.repeat(40),
      actor: 'author',
      status: 'running',
      createdAt: '',
      updatedAt: '',
    },
    jobs: [],
    cachedAt: new Date().toISOString(),
  })
  await f.s.pipelineWatch.command({ taskId: f.taskId, action: 'watch', runIds: ['7'] })
  await f.s.pullRequestWatch.command({ taskId: f.taskId, action: 'stop' })
  expect(f.s.store.task(f.taskId).waitingForFeedback).toBe(true)
  let complete!: (value: PullDetail) => void
  f.read.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve
      }),
  )
  const registration = f.watch()
  f.s.store.updateTask(f.taskId, (task) => ({ ...task, archived: true }))
  f.s.store.updateTask(f.taskId, (task) => ({ ...task, archived: false }))
  complete(detail())
  await expect(registration).rejects.toThrow('replaced or stopped')
  expect(await f.status()).toEqual({ watch: null })
})

it('rolls back watch removal and Waiting together when settlement cannot commit', async () => {
  const f = await setup()
  f.s.store.updateTask(f.taskId, (task) => ({ ...task, status: 'review' }))
  await f.watch()
  expect(() =>
    f.s.store.transaction(() => {
      f.s.store.updateTask(f.taskId, (task) => ({ ...task, archived: true }))
      throw new Error('settlement failed')
    }),
  ).toThrow('settlement failed')
  expect(f.s.store.task(f.taskId).waitingForFeedback).toBe(true)
  expect(f.s.store.task(f.taskId).archived).not.toBe(true)
  expect(await f.status()).toMatchObject({ watch: { status: 'watching' } })
})
