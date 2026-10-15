import { Effect } from 'effect'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import {
  decode,
  reviewProgressSchema,
  pullDetailSchema,
  type ReviewContext,
  type PullDetail,
} from '@dovo/protocol'
import { startRuntime } from '../index'
import { retainChangedFiles } from '../scm/git/retain-changes'
function taggedDetail(detail: PullDetail) {
  const destination = 'account/repo'
  return { ...detail, destination, pull: { ...detail.pull, destination } }
}
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.restoreAllMocks()
})
it('rejects working-file ABA writes and preserves unrelated viewed versions through rescans', async () => {
  const { runtime, request, read, mobile, files } = await setup()
  const context: ReviewContext = { kind: 'task', taskId: 'task', source: 'working' }
  const initial = await read(context)
  expect((await request(context, mobile, { ...initial.files[0], viewed: true })).status).toBe(200)
  const marked = await read(context, mobile)
  expect((await request(context, mobile, { ...marked.files[0], viewed: false })).status).toBe(200)
  expect((await request(context, undefined, { ...initial.files[0], viewed: true })).status).toBe(
    409,
  )
  expect((await request(context, undefined, { ...initial.files[1], viewed: true })).status).toBe(
    200,
  )
  const reviewed = await read(context)
  runtime.services.store.updateTask('task', (task) => ({
    ...task,
    files: retainChangedFiles(
      task.files,
      files.map((file) => ({ ...file })),
    ),
  }))
  expect((await read(context)).files).toEqual(reviewed.files)
  runtime.services.store.updateTask('task', (task) => ({
    ...task,
    files: task.files.filter((file) => file.path !== files[0].path),
  }))
  runtime.services.store.updateTask('task', (task) => ({
    ...task,
    files: [files[0], ...task.files],
  }))
  expect((await request(context, mobile, { ...reviewed.files[0], viewed: true })).status).toBe(409)
})
async function setup() {
  const owner = 'file-review-test-owner-token-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: owner, port: 0 })
  cleanup.push(runtime.close)
  const desktop = 'desktop-test-device-token-at-least-32-characters',
    mobile = 'mobile-test-device-token-at-least-32-characters'
  runtime.services.devices.add('Desktop', desktop)
  runtime.services.devices.add('Mobile', mobile)
  const files = [
    { path: 'types.ts', before: 'export const n = 1', after: 'export const n = 2', viewed: false },
    {
      path: 'app.ts',
      before: "import {n} from './types'; console.log(n)",
      after: "import {n} from './types'; console.log(n+1)",
      viewed: false,
    },
  ]
  runtime.services.store.update((workspace) => ({
    ...workspace,
    repositories: [{ id: 'repo', name: 'Repo', path: '/file-review-test/absent', branch: 'main' }],
    tasks: [
      {
        id: 'task',
        title: 'Task',
        agentId: '',
        repositoryId: 'repo',
        status: 'done',
        createdAt: '2026-10-10',
        messages: [],
        files,
        draft: '',
        example: false,
        turns: [
          {
            id: 'turn',
            assistantId: 'assistant',
            agentId: '',
            provider: 'codex',
            model: '',
            status: 'completed',
            startedAt: '2026-10-10',
            checkpoint: { before: 'a', after: 'b', files, omitted: [] },
          },
        ],
      },
    ],
  }))
  const request = async (
    context: ReviewContext,
    token = desktop,
    mark?: { path: string; fingerprint: string; viewed: boolean; version: number },
  ) => {
    const response = await fetch(
      `http://127.0.0.1:${runtime.port}/api/review/${mark ? 'set' : 'read'}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(mark ? { context, ...mark } : { context }),
      },
    )
    return response
  }
  const read = async (context: ReviewContext, token = desktop) => {
    const response = await request(context, token)
    expect(response.status).toBe(200)
    return decode(reviewProgressSchema, await response.json())
  }
  return { runtime, request, read, desktop, mobile, files }
}
it('authenticates paired clients, shares granular working/history marks and rejects changed file baselines', async () => {
  const { runtime, request, read, mobile, files } = await setup()
  const context: ReviewContext = { kind: 'task', taskId: 'task', source: 'working' }
  expect((await request(context, '')).status).toBe(401)
  const initial = await read(context)
  expect(initial.groups[0]).toMatchObject({ basis: 'ast', paths: ['types.ts', 'app.ts'] })
  expect((await request(context, undefined, { ...initial.files[0], viewed: true })).status).toBe(
    200,
  )
  expect((await read(context, mobile)).files[0].viewed).toBe(true)
  runtime.services.store.updateTask('task', (task) => ({
    ...task,
    files: task.files.map((file) =>
      file.path === 'app.ts' ? { ...file, after: 'new contents', viewed: false } : file,
    ),
  }))
  expect((await request(context, mobile, { ...initial.files[1], viewed: true })).status).toBe(409)
  expect(runtime.services.store.task('task').files[1].after).toBe('new contents')
  expect(runtime.services.store.task('task').files[0].viewed).toBe(true)
  const history: ReviewContext = { ...context, source: 'turn', turnId: 'turn' }
  const historical = await read(history)
  expect((await request(history, mobile, { ...historical.files[0], viewed: true })).status).toBe(
    200,
  )
  expect((await read(history)).files[0].viewed).toBe(true)
  expect(runtime.services.store.task('task').turns?.[0].checkpoint?.files).toEqual(files) // Checkpoint content remains immutable.
})
it('retains unchanged PR progress across pushes, resets changed patches and isolates repository identities', async () => {
  const { runtime, request, read, mobile } = await setup()
  vi.spyOn(runtime.services.pulls, 'identity').mockResolvedValue('account/repo')
  vi.spyOn(runtime.services.git, 'reviewSources').mockResolvedValue([])
  let detail = taggedDetail(
    decode(pullDetailSchema, {
      pull: {
        number: 1,
        title: 'PR',
        url: 'https://github.com/a/repo/pull/1',
        repositoryUrl: 'https://github.com/a/repo',
        state: 'open',
        draft: false,
        author: 'dev',
        updatedAt: '2026-10-10',
        head: 'fix',
        base: 'main',
        labels: [],
        headSha: 'a'.repeat(40),
        baseSha: 'b'.repeat(40),
        body: '',
        additions: 2,
        deletions: 2,
        changedFiles: 2,
        mergeable: true,
        reviewers: [],
        assignees: [],
      },
      files: [
        {
          path: 'a.ts',
          status: 'modified',
          additions: 1,
          deletions: 1,
          patch: '@@ -1 +1 @@\n-old\n+new',
        },
        {
          path: 'b.ts',
          status: 'modified',
          additions: 1,
          deletions: 1,
          patch: '@@ -1 +1 @@\n-old\n+new',
        },
      ],
      comments: [],
      checks: [],
      warnings: [],
    }),
  )
  vi.spyOn(runtime.services.pulls, 'section').mockImplementation(async () => detail)
  const context: ReviewContext = { kind: 'pull', repositoryId: 'repo', number: 1 }
  const initial = await read(context)
  for (const file of initial.files)
    expect((await request(context, mobile, { ...file, viewed: true })).status).toBe(200)
  vi.spyOn(runtime.services.pulls, 'feedback').mockImplementation(async () => ({
    ...detail,
    files: [],
  }))
  await runtime.services.pullCache.feedback('/file-review-test/absent', 1, true)
  expect((await read(context)).files.every((file) => file.viewed)).toBe(true)
  const oldDetail = detail
  detail = {
    ...detail,
    pull: { ...detail.pull, headSha: 'c'.repeat(40) },
    files: [{ ...detail.files[0], patch: '@@ -1 +1 @@\n-old\n+newer' }, detail.files[1]],
  }
  await Effect.runPromise(
    runtime.services.pullCache.sectionEffect('/file-review-test/absent', 1, 'changes', true),
  )
  expect((await read(context)).files.map((file) => file.viewed)).toEqual([false, true])
  const current = await read(context)
  expect((await request(context, mobile, { ...current.files[0], viewed: true })).status).toBe(200)
  const cachedRead = vi
    .spyOn(runtime.services.pullCache, 'sectionEffect')
    .mockReturnValue(Effect.succeed(oldDetail))
  expect((await read(context)).files.every((file) => file.viewed)).toBe(true)
  cachedRead.mockRestore()
  expect((await read(context)).files.every((file) => file.viewed)).toBe(true)

  expect((await request(context, mobile, { ...initial.files[0], viewed: true })).status).toBe(409)
  // A provider failure must not clear saved progress as if all files were removed.
  detail = { ...detail, files: [], warnings: ['Files: unavailable'] }
  await Effect.runPromise(
    runtime.services.pullCache.sectionEffect('/file-review-test/absent', 1, 'changes', true),
  )
  expect((await request(context)).status).toBe(503)
  detail = {
    ...detail,
    pull: { ...detail.pull, url: 'https://github.com/b/other/pull/1' },
    files: [
      {
        path: 'b.ts',
        status: 'modified',
        additions: 1,
        deletions: 1,
        patch: '@@ -1 +1 @@\n-old\n+new',
      },
    ],
    warnings: [],
  }
  await Effect.runPromise(
    runtime.services.pullCache.sectionEffect('/file-review-test/absent', 1, 'changes', true),
  )
  expect((await read(context)).files[0].viewed).toBe(false)
})
it('retries unavailable PR sources after the cache interval and isolates local checkout identity', async () => {
  const { runtime, read } = await setup()
  vi.spyOn(runtime.services.pulls, 'identity').mockResolvedValue('account/repo')
  const detail = taggedDetail(
    decode(pullDetailSchema, {
      pull: {
        number: 1,
        title: 'PR',
        url: 'https://github.com/a/repo/pull/1',
        repositoryUrl: 'https://github.com/a/repo',
        state: 'open',
        draft: false,
        author: 'dev',
        updatedAt: '',
        head: 'fix',
        base: 'main',
        labels: [],
        headSha: 'a'.repeat(40),
        baseSha: 'b'.repeat(40),
        body: '',
        additions: 2,
        deletions: 2,
        changedFiles: 2,
        mergeable: true,
        reviewers: [],
        assignees: [],
      },
      files: ['caller.ts', 'model.ts'].map((path) => ({
        path,
        status: 'modified',
        additions: 1,
        deletions: 1,
        patch: '@@ -1 +1 @@\n-old\n+new',
      })),
      comments: [],
      checks: [],
      warnings: [],
    }),
  )
  vi.spyOn(runtime.services.pulls, 'section').mockResolvedValue(detail)
  const sources = vi.spyOn(runtime.services.git, 'reviewSources').mockResolvedValue([])
  let now = Date.now()
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  const context: ReviewContext = { kind: 'pull', repositoryId: 'repo', number: 1 }
  expect((await read(context)).groups.every((group) => group.basis === 'folder')).toBe(true)
  await read(context)
  expect(sources).toHaveBeenCalledOnce()
  sources.mockResolvedValue([
    {
      path: 'caller.ts',
      before: "import {User} from './model'",
      after: "import {User} from './model'; const user = new User()",
    },
    { path: 'model.ts', before: 'export class User {}', after: 'export class User {id = 1}' },
  ])
  now += 20_001
  expect((await read(context)).groups).toEqual([
    { label: 'model.ts', paths: ['model.ts', 'caller.ts'], basis: 'ast' },
  ])
  now += 20_001
  await read(context)
  expect(sources).toHaveBeenCalledTimes(2)
  runtime.services.store.update((workspace) => ({
    ...workspace,
    repositories: workspace.repositories.map((repo) => ({ ...repo, path: '/other-checkout' })),
  }))
  await read(context)
  expect(sources).toHaveBeenCalledTimes(3)
})
it('isolates identical working sources whose Go module identities differ between tasks', async () => {
  const { runtime, read } = await setup()
  const files = [
    {
      path: 'api/view.go',
      before: 'package api\n',
      after: 'package api\nimport "example.com/first/model"\nvar user model.User\n',
      viewed: false,
    },
    {
      path: 'model/user.go',
      before: 'package model\n',
      after: 'package model\ntype User struct{}\n',
      viewed: false,
    },
  ]
  runtime.services.store.update((workspace) => ({
    ...workspace,
    tasks: [
      { ...workspace.tasks[0], files },
      { ...runtime.services.store.task(workspace.tasks[0].id), id: 'second', files },
    ],
  }))
  vi.spyOn(runtime.services.checkouts, 'reviewDirectory').mockImplementation(
    async (id) => `/checkout/${id}`,
  )
  vi.spyOn(runtime.services.git, 'reviewGoModules').mockImplementation(async (cwd) => [
    {
      path: 'go.mod',
      before: '',
      after: `module example.com/${cwd.endsWith('/task') ? 'first' : 'second'}`,
    },
  ])
  const first = await read({ kind: 'task', taskId: 'task', source: 'working' })
  expect(first.groups[0]).toMatchObject({ basis: 'ast', paths: ['model/user.go', 'api/view.go'] })
  const second = await read({ kind: 'task', taskId: 'second', source: 'working' })
  expect(second.groups.every((group) => group.basis === 'folder')).toBe(true)
})

it('organizes authenticated current diffs and rejects invalid output and stale analysis without altering viewed marks', async () => {
  const { runtime, read, request, desktop } = await setup()
  const context: ReviewContext = { kind: 'task', taskId: 'task', source: 'working' }
  const initial = await read(context)
  await request(context, desktop, { ...initial.files[0], viewed: true })
  const selection = {
    harness: { provider: 'codex', endpoint: '' },
    model: 'review-model',
    reasoning: '',
  }
  const output = {
    groups: [
      {
        label: 'Shared contract',
        summary: 'Updates the value and caller',
        impact: 'Inspect app.ts consuming types.ts',
        paths: ['types.ts', 'app.ts'],
      },
    ],
  }
  const model = vi
    .spyOn(runtime.services.titles, 'organizeReview')
    .mockResolvedValue(JSON.stringify(output))
  const organize = (files = initial.files, token = desktop) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/review/organize`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context,
        selection,
        files: files.map(({ path, fingerprint }) => ({ path, fingerprint })),
      }),
    })
  expect((await organize(initial.files, '')).status).toBe(401)
  const response = await organize()
  expect(response.status).toBe(200)
  const result = decode(reviewProgressSchema, await response.json())
  expect(result.groups[0]).toMatchObject({ ...output.groups[0], basis: 'feature' })
  expect(result.files[0].viewed).toBe(true)
  expect(model).toHaveBeenCalledWith(
    expect.stringContaining('dependencies'),
    expect.objectContaining(selection),
  )
  expect((await read(context)).groups[0].basis).toBe('ast')
  const titles = runtime.services.titles.save({
    harness: { provider: 'codex', endpoint: 'title-harness' },
    model: 'title-model',
    reasoning: 'low',
  })
  const defaultResponse = await fetch(`http://127.0.0.1:${runtime.port}/api/review/organize`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${desktop}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      context,
      files: initial.files.map(({ path, fingerprint }) => ({ path, fingerprint })),
    }),
  })
  expect(defaultResponse.status).toBe(200)
  expect(model).toHaveBeenLastCalledWith(expect.any(String), titles)
  model.mockResolvedValue(
    JSON.stringify({ groups: [{ ...output.groups[0], paths: ['invented.ts'] }] }),
  )
  expect((await organize()).status).toBe(502)
  model.mockImplementation(async () => {
    runtime.services.store.updateTask('task', (task) => ({
      ...task,
      files: task.files.map((file) => ({ ...file, after: file.after + '\n// new revision' })),
    }))
    return JSON.stringify(output)
  })
  expect((await organize()).status).toBe(409)
  model.mockClear()
  expect((await organize()).status).toBe(409)
  expect(model).not.toHaveBeenCalled()
})
