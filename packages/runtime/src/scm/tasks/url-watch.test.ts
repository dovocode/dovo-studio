import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import type { PullDetail } from '@dovo/protocol'
import { startRuntime } from '../../index.js'
import { fixture } from '../../testing/fixture.js'
import { PullRequests } from '../pulls/pulls.js'
import { PipelineWatch } from './pipeline-watch.js'
import { PullRequestWatch } from './pull-request-watch.js'
import { pipelineUrlTarget } from './watch-source.js'
import { taskWaiting } from '../../http/endpoints/task-waiting.js'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.restoreAllMocks()
  vi.useRealTimers()
})
const pullUrl = 'https://github.com/foreign/project/pull/7'
const runUrl = 'https://github.com/foreign/project/actions/runs/8'
const feedback = (): PullDetail => ({
  pull: {
    number: 7,
    title: 'Fix',
    url: pullUrl,
    state: 'open',
    draft: false,
    author: 'author',
    updatedAt: '2026-10-07T10:00:00Z',
    head: 'fix',
    base: 'main',
    labels: [],
    repositoryUrl: 'https://github.com/foreign/project',
    headSha: 'a'.repeat(40),
    baseSha: 'b'.repeat(40),
    body: '',
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    mergeable: true,
    reviewers: [],
    assignees: [],
  },
  comments: [],
  checks: [],
  files: [],
  warnings: [],
})
async function setup(general = false) {
  const f = await fixture()
  cleanup.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: join(f.directory, 'watch.sqlite'),
    port: 0,
    ownerToken: 'url-watch-owner-token-with-at-least-32-characters',
  })
  cleanup.push(() => runtime.close())
  const s = runtime.services
  const selected = s.forges.save({
    name: 'Thread account',
    provider: 'github',
    baseUrl: 'https://github.com',
    credential: 'token',
    token: 'thread-secret',
  })
  if (!general)
    s.forges.save({
      name: 'Other account',
      provider: 'github',
      baseUrl: 'https://github.com',
      credential: 'token',
      token: 'other-secret',
    })
  s.store.update(() => ({
    ...f.workspace,
    repositories: f.workspace.repositories.map((repo) => ({
      ...repo,
      forge: { connectionId: selected.id, repository: 'team/origin', revision: selected.revision },
    })),
  }))
  const task = s.tasks.create({
    title: 'Monitor',
    agentId: 'agent',
    objective: '',
    repositoryId: general ? 'scratch' : 'repo',
  })
  s.store.updateTask(task.id, (task) => ({
    ...task,
    status: 'review',
    queuePaused: true,
    queue: [],
  }))
  s.preferences.save({ enablePullRequestWatching: true, enablePipelineWatching: true })
  let pipelineStatus = 'in_progress'
  let accountId = 1
  const api = vi
    .spyOn(s.git, 'githubAccount')
    .mockImplementation(async (args, _limits, _cwd, credential) => {
      expect(credential?.token).toBe('thread-secret')
      if (args.at(-1) === 'user') return JSON.stringify({ id: accountId, login: 'viewer' })
      const path = args.find((arg) => arg.startsWith('repos/'))
      if (path === 'repos/foreign/project/actions/runs/8')
        return JSON.stringify({
          id: 8,
          name: 'Build',
          html_url: runUrl,
          head_sha: 'b'.repeat(40),
          status: pipelineStatus,
        })
      if (path?.startsWith('repos/foreign/project/actions/runs/8/jobs'))
        return JSON.stringify({ jobs: [] })
      throw new Error(`Unexpected provider operation: ${args.join(' ')}`)
    })
  const read = vi
    .spyOn(PullRequests.prototype, 'feedback')
    .mockImplementation(async () => feedback())
  return {
    runtime,
    databasePath: join(f.directory, 'watch.sqlite'),
    s,
    task,
    api,
    read,
    selected,
    fail: () => {
      pipelineStatus = 'failure'
    },
    switchAccount: () => {
      accountId = 2
    },
  }
}
it.each([false, true])(
  'watches URLs with no target checkout, inherits the account and delivers after reload (General: %s)',
  async (general) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const f = await setup(general)
    const projects = f.s.store.get().repositories
    const pull = await f.s.pullRequestWatch.command({
      taskId: f.task.id,
      action: 'watch',
      url: pullUrl,
    })
    const pipeline = await f.s.pipelineWatch.command({
      taskId: f.task.id,
      action: 'watch',
      url: runUrl,
    })
    expect(pull.watches[0]?.repositoryId).toMatch(/^external:/)
    expect(pipeline.watches[0]?.repositoryId).toBe(pull.watches[0]?.repositoryId)
    expect(f.s.store.get().repositories).toEqual(projects)
    expect(f.s.store.task(f.task.id).waitingForFeedback).toBe(true)
    const waiting = await taskWaiting(f.s, { taskId: f.task.id })
    expect(waiting.dependencies).toHaveLength(2)
    expect(
      waiting.dependencies.every((watch) => watch.project === 'github.com/foreign/project'),
    ).toBe(true)
    const saved = JSON.stringify(
      f.s.db
        .prepare(
          'SELECT value FROM task_pull_watches UNION ALL SELECT value FROM task_pipeline_watches',
        )
        .all(),
    )
    expect(saved).not.toMatch(/thread-secret|other-secret/)
    // New instances reload all routing, account and cursor state from SQLite.
    const pulls = new PullRequestWatch(f.s.db, f.s)
    const pipelines = new PipelineWatch(f.s.db, f.s)
    f.read.mockResolvedValue({
      ...feedback(),
      comments: [
        {
          id: 'new',
          kind: 'comment',
          author: 'reviewer',
          body: 'Please fix',
          date: '2026-10-22T12:00:00Z',
          url: `${pullUrl}#new`,
        },
      ],
    })
    f.fail()
    // Background watchers intentionally share the distributed cache for 45 seconds.
    vi.setSystemTime(Date.now() + 120_000)
    await pulls.tick()
    await pipelines.tick()
    await pulls.tick()
    await pipelines.tick()
    expect(
      (await pulls.command({ taskId: f.task.id, action: 'status' })).watches[0]?.error,
    ).toBeUndefined()
    expect(
      (await pipelines.command({ taskId: f.task.id, action: 'status' })).watches[0]?.error,
    ).toBeUndefined()
    expect(f.s.store.task(f.task.id).queue?.map((item) => item.text.split('\n')[0])).toEqual([
      `Dovo PR feedback for ${pullUrl}`,
      `Dovo pipeline completion for ${runUrl}`,
    ])
    expect(f.s.store.task(f.task.id).queuePaused).toBe(true)
    expect(
      (await pipelines.command({ taskId: f.task.id, action: 'status', url: `${runUrl}/job/10` }))
        .watches[0]?.status,
    ).toBe('completed')
    await pulls.command({ taskId: f.task.id, action: 'stop', url: pullUrl })
    expect(f.s.store.task(f.task.id).waitingForFeedback).toBeUndefined()
  },
)
it('keeps the primary and linked project watchers independent of external repositories and stops on lost access', async () => {
  const f = await setup()
  f.s.store.updateTask(f.task.id, (task) => ({
    ...task,
    repositoryId: 'scratch',
    linkedCheckouts: [{ id: 'link', repositoryId: 'repo', execution: 'main', access: 'edit' }],
  }))
  await f.s.pullRequestWatch.command({
    taskId: f.task.id,
    action: 'watch',
    url: pullUrl,
  })
  await f.s.pipelineWatch.command({
    taskId: f.task.id,
    action: 'watch',
    url: runUrl,
  })
  f.api.mockClear()
  f.read.mockClear()
  f.s.store.updateTask(f.task.id, (task) => ({ ...task, linkedCheckouts: [] }))
  await f.s.pullRequestWatch.tick()
  await f.s.pipelineWatch.tick()
  expect(f.api).not.toHaveBeenCalled()
  expect(f.read).not.toHaveBeenCalled()
  expect(
    (await f.s.pullRequestWatch.command({ taskId: f.task.id, action: 'status' })).watches[0]
      ?.status,
  ).toBe('stopped')
  expect(
    (await f.s.pipelineWatch.command({ taskId: f.task.id, action: 'status' })).watches[0]?.status,
  ).toBe('stopped')
})
it('rejects changed accounts before reading target feedback or jobs', async () => {
  const f = await setup()
  await f.s.pullRequestWatch.command({ taskId: f.task.id, action: 'watch', url: pullUrl })
  await f.s.pipelineWatch.command({ taskId: f.task.id, action: 'watch', url: runUrl })
  f.api.mockClear()
  f.read.mockClear()
  // Changing the bound connection invalidates its persisted destination, even for the same user.
  f.s.forges.save({ ...f.selected, name: 'Changed' })
  await f.s.pullRequestWatch.tick()
  await f.s.pipelineWatch.tick()
  expect(f.read).not.toHaveBeenCalled()
  expect(f.api.mock.calls.every(([args]) => args.at(-1) === 'user')).toBe(true)
  expect(
    (await f.s.pullRequestWatch.command({ taskId: f.task.id, action: 'status' })).watches[0]?.error,
  ).toMatch(/changed/)
  expect(f.s.store.task(f.task.id).queue).toHaveLength(0)
  const recovered = await f.s.pullRequestWatch.command({
    taskId: f.task.id,
    action: 'watch',
    url: pullUrl,
  })
  expect(recovered.watches[0]?.error).toBeUndefined()
  await f.s.pullRequestWatch.tick()
  expect(
    (await f.s.pullRequestWatch.command({ taskId: f.task.id, action: 'status' })).watches[0]?.error,
  ).toBeUndefined()
})
it('stops existing external watches by their returned keys while an account lookup is pending', async () => {
  const f = await setup()
  const pull = await f.s.pullRequestWatch.command({
    taskId: f.task.id,
    action: 'watch',
    url: pullUrl,
  })
  await f.s.pipelineWatch.command({ taskId: f.task.id, action: 'watch', url: runUrl })
  const key = pull.watches[0]!.repositoryId
  const source = await f.s.pulls.watchSource(pullUrl, 'repo')
  let finish!: (value: typeof source) => void
  vi.spyOn(f.s.pulls, 'watchSource').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const pending = f.s.pullRequestWatch.command({
    taskId: f.task.id,
    action: 'watch',
    url: pullUrl,
    repositoryId: 'repo',
  })
  const rejected = pending.then(
    () => undefined,
    (error: unknown) => error,
  )
  await f.s.pullRequestWatch.manage({
    taskId: f.task.id,
    action: 'stop',
    repositoryId: key,
    url: pullUrl,
  })
  finish(source)
  expect(await rejected).toMatchObject({ status: 409 })
  const pipeline = f.s.pipelineWatch.command({ taskId: f.task.id, action: 'watch', url: runUrl })
  const pipelineRejected = pipeline.then(
    () => undefined,
    (error: unknown) => error,
  )
  await f.s.pipelineWatch.manage({
    taskId: f.task.id,
    action: 'stop',
    repositoryId: key,
    runIds: ['8'],
  })
  finish(source)
  expect(await pipelineRejected).toMatchObject({ status: 409 })
})
it('restores URL watches and inherited account routing after a full runtime restart', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  const f = await setup()
  await f.s.pullRequestWatch.command({ taskId: f.task.id, action: 'watch', url: pullUrl })
  await f.s.pipelineWatch.command({ taskId: f.task.id, action: 'watch', url: runUrl })
  await f.runtime.close()
  vi.setSystemTime(Date.now() + 120_000)
  const runtime = await startRuntime({
    databasePath: f.databasePath,
    port: 0,
    ownerToken: 'url-watch-owner-token-with-at-least-32-characters',
  })
  cleanup.push(() => runtime.close())
  const api = f.api.getMockImplementation()
  if (!api) throw new Error('Missing provider fixture')
  vi.spyOn(runtime.services.git, 'githubAccount').mockImplementation(api)
  f.read.mockResolvedValue({
    ...feedback(),
    comments: [
      {
        id: 'restart',
        kind: 'comment',
        author: 'reviewer',
        body: 'After restart',
        date: '2026-10-22T12:00:00Z',
        url: `${pullUrl}#restart`,
      },
    ],
  })
  f.fail()
  const s = runtime.services
  expect(s.store.task(f.task.id).waitingForFeedback).toBe(true)
  await s.pullRequestWatch.tick()
  await s.pipelineWatch.tick()
  expect(s.store.task(f.task.id).queue).toHaveLength(2)
  expect(
    s.store.get().repositories.some((repo) => repo.forge?.repository === 'foreign/project'),
  ).toBe(false)
})
it('requires an unambiguous account in General and never sends credentials to an unknown host', async () => {
  const f = await setup(true)
  f.s.forges.save({
    name: 'Another',
    provider: 'github',
    baseUrl: 'https://github.com',
    credential: 'token',
    token: 'other-secret',
  })
  // No existing target project may silently choose an account for this external URL.
  await expect(
    f.s.pullRequestWatch.command({ taskId: f.task.id, action: 'watch', url: pullUrl }),
  ).rejects.toThrow('Multiple')
  await expect(
    f.s.pipelineWatch.command({
      taskId: f.task.id,
      action: 'watch',
      url: runUrl.replace('github.com', 'untrusted.example'),
    }),
  ).rejects.toMatchObject({ status: 400 })
  expect(f.api).not.toHaveBeenCalled()
  const selected = await f.s.pullRequestWatch.command({
    taskId: f.task.id,
    action: 'watch',
    url: pullUrl,
    connectionId: f.selected.id,
  })
  expect(selected.watches[0]?.source?.connectionId).toBe(f.selected.id)
})
it.each([
  {
    provider: 'gitlab',
    baseUrl: 'http://git.example',
    url: 'http://git.example/group/foreign/-/merge_requests/7',
    repository: 'group/foreign',
    user: { id: 42 },
  },
  {
    provider: 'gitea',
    baseUrl: 'https://git.example',
    url: 'https://git.example/foreign/project/pulls/7',
    repository: 'foreign/project',
    user: { id: 42 },
  },
  {
    provider: 'forgejo',
    baseUrl: 'https://forge.example',
    url: 'https://forge.example/foreign/project/pulls/7',
    repository: 'foreign/project',
    user: { id: 42 },
  },
  {
    provider: 'azure-devops',
    baseUrl: 'https://dev.azure.com/org',
    url: 'https://dev.azure.com/org/project/_git/foreign/pullrequest/7',
    repository: 'project/foreign',
    user: { authenticatedUser: { id: 'viewer' } },
  },
  {
    provider: 'bitbucket',
    baseUrl: 'https://api.bitbucket.org/2.0',
    url: 'https://bitbucket.org/foreign/project/pull-requests/7',
    repository: 'foreign/project',
    user: { uuid: 'viewer' },
  },
] as const)(
  'resolves external $provider PRs through the configured account and instance',
  async (input) => {
    const f = await setup()
    const account = f.s.forges.save({
      name: input.provider,
      provider: input.provider,
      baseUrl: input.baseUrl,
      credential: 'token',
      token: 'provider-secret',
      ...(input.provider === 'bitbucket' ? { username: 'viewer@example.com' } : {}),
    })
    f.s.store.update((workspace) => ({
      ...workspace,
      repositories: workspace.repositories.map((repo) =>
        repo.id === 'repo'
          ? {
              ...repo,
              forge: {
                connectionId: account.id,
                repository: 'team/origin',
                revision: account.revision,
              },
            }
          : repo,
      ),
    }))
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify(input.user), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const target = await f.s.pulls.watchSource(input.url, 'repo')
    if (!target.source) throw new Error('Expected external source')
    const { scope } = await f.s.pulls.watchReader(target.source).context()
    expect(scope.repository).toBe(input.repository)
    expect(scope.provider).toBe(input.provider)
    expect(scope.connection?.id).toBe(account.id)
    expect(
      fetcher.mock.calls.every(([url]) =>
        (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).startsWith(
          input.baseUrl,
        ),
      ),
    ).toBe(true)
    expect(f.api).not.toHaveBeenCalled()
  },
)
it('cancels registration during slow account discovery for both watcher tools', async () => {
  const f = await setup()
  const resolveSource = f.s.pulls.watchSource.bind(f.s.pulls)
  const source = await resolveSource(pullUrl, 'repo')
  let finish!: (value: typeof source) => void
  vi.spyOn(f.s.pulls, 'watchSource').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const pending = f.s.pullRequestWatch.command({ taskId: f.task.id, action: 'watch', url: pullUrl })
  const rejected = pending.then(
    () => undefined,
    (error: unknown) => error,
  )
  await f.s.pullRequestWatch.command({ taskId: f.task.id, action: 'stop' })
  finish(source)
  expect(await rejected).toMatchObject({ status: 409 })
  const pipeline = f.s.pipelineWatch.command({ taskId: f.task.id, action: 'watch', url: runUrl })
  const pipelineRejected = pipeline.then(
    () => undefined,
    (error: unknown) => error,
  )
  await f.s.pipelineWatch.command({ taskId: f.task.id, action: 'stop' })
  finish(source)
  expect(await pipelineRejected).toMatchObject({ status: 409 })
  expect(f.read).not.toHaveBeenCalled()
  expect(
    (await f.s.pipelineWatch.command({ taskId: f.task.id, action: 'status' })).watches,
  ).toEqual([])
})
it.each([
  ['https://github.com/team/project/actions/runs/8/job/9?check=1', '8'],
  ['https://gitlab.com/group/subgroup/project/-/pipelines/27', '27'],
  ['http://git.example/team/project/actions/runs/9', '9'],
  ['https://user:secret@github.com/team/project/actions/runs/8', undefined],
  ['https://github.com/team/project/actions/runs/nope', undefined],
])('parses explicit pipeline links: %s', (url, id) => {
  expect(pipelineUrlTarget(url)?.id).toBe(id)
})
