import { Effect } from 'effect'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import {
  createReviewSession,
  decode,
  reviewProgressSchema,
  type ReviewSessionState,
  pullDetailSchema,
  type ReviewContext,
  type PullDetail,
} from '@dovo/protocol'
import { startRuntime } from '../index'
import { retainChangedFiles } from '../scm/git/retain-changes'
import { runtimeIntegration } from '../testing/integration'

vi.setConfig(runtimeIntegration)

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
it('reads working and saved review progress without inspecting checkout sources', async () => {
  const { runtime, read, request } = await setup()
  const checkout = vi.spyOn(runtime.services.checkouts, 'reviewDirectory')
  const git = vi.spyOn(runtime.services.git, 'command')
  const context: ReviewContext = { kind: 'task', taskId: 'task', source: 'working' }
  const progress = await read(context)
  expect(progress.groups).toEqual([])
  await request(context, undefined, { ...progress.files[0], viewed: true })
  await read({ ...context, source: 'turn', turnId: 'turn' })
  expect(checkout).not.toHaveBeenCalled()
  expect(git).not.toHaveBeenCalled()
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
  expect(initial.groups).toEqual([])
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
  expect(initial.groups).toEqual([])
  const model = vi.spyOn(runtime.services.titles, 'organizeReview').mockResolvedValue(
    JSON.stringify({
      groups: [
        {
          label: 'Feature',
          summary: 'Update both files',
          impact: 'Check callers',
          paths: ['a.ts', 'b.ts'],
        },
      ],
    }),
  )
  const organized = await fetch(`http://127.0.0.1:${runtime.port}/api/review/organize`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${mobile}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      context,
      guided: true,
      revision: initial.revision,
      files: initial.files.map(({ path, fingerprint }) => ({ path, fingerprint })),
    }),
  })
  expect(organized.status).toBe(200)
  expect(JSON.parse(model.mock.calls[0][0])).toEqual({
    changes: detail.files.map((file) => ({
      path: file.path,
      evidence: file.patch,
      incomplete: false,
    })),
  })
  for (const file of initial.files)
    expect((await request(context, mobile, { ...file, viewed: true })).status).toBe(200)
  const firstGuide = (await read(context)).guide
  expect(firstGuide).toBeDefined()
  const previousHead = detail
  detail = { ...detail, pull: { ...detail.pull, headSha: 'f'.repeat(40) } }
  await Effect.runPromise(
    runtime.services.pullCache.sectionEffect('/file-review-test/absent', 1, 'changes', true),
  )
  const advanced = await read(context)
  expect(advanced.files.map((file) => file.fingerprint)).toEqual(
    initial.files.map((file) => file.fingerprint),
  )
  expect(advanced.revision).not.toBe(initial.revision)
  expect(advanced.guide).toBeUndefined()
  const staleSection = vi
    .spyOn(runtime.services.pullCache, 'sectionEffect')
    .mockReturnValueOnce(Effect.succeed(previousHead))
  expect((await read(context)).guide).toBeUndefined()
  expect(staleSection).toHaveBeenCalledWith('/file-review-test/absent', 1, 'changes', true)
  staleSection.mockRestore()
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
  const evidence = JSON.parse(model.mock.calls[0][0])
  expect(Object.keys(evidence)).toEqual(['changes'])
  expect(evidence.changes).toEqual([
    expect.objectContaining({
      path: 'types.ts',
      evidence: expect.stringContaining('+export const n = 2'),
      incomplete: false,
    }),
    expect.objectContaining({
      path: 'app.ts',
      evidence: expect.stringContaining('+import {n}'),
      incomplete: false,
    }),
  ])
  expect(model).toHaveBeenCalledWith(expect.any(String), expect.objectContaining(selection))
  expect((await read(context)).groups).toEqual([])
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

it('shares verified guided reviews and saved step progress, and refuses stale guides after edits', async () => {
  const { runtime, read, desktop, mobile, request } = await setup()
  const context: ReviewContext = { kind: 'task', taskId: 'task', source: 'working' }
  const initial = await read(context)
  vi.spyOn(runtime.services.titles, 'organizeReview').mockResolvedValue(
    JSON.stringify({
      groups: [
        {
          label: 'Contract',
          summary: 'Changes value and caller',
          impact: 'Check the caller',
          paths: ['types.ts', 'app.ts'],
          excerpts: [
            { path: 'types.ts', side: 'after', start: 1, end: 1 },
            { path: 'app.ts', side: 'after', start: 900, end: 901 },
          ],
          questions: ['Does the caller use the new value?'],
        },
      ],
    }),
  )
  const response = await fetch(`http://127.0.0.1:${runtime.port}/api/review/organize`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${desktop}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      context,
      guided: true,
      revision: initial.revision,
      files: initial.files.map(({ path, fingerprint }) => ({ path, fingerprint })),
    }),
  })
  expect(response.status).toBe(200)
  const organized = decode(reviewProgressSchema, await response.json())
  expect(organized.guide?.steps[0].excerpts).toEqual([
    { path: 'types.ts', side: 'after', start: 1, end: 1, text: 'export const n = 2' },
  ])
  expect((await read(context, mobile)).guide).toEqual(organized.guide)
  const move = (token = mobile, version = 0) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/review/guide`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context,
        move: { id: organized.guide?.id, version, position: 0, reviewed: 0 },
      }),
    })
  expect((await move('')).status).toBe(401)
  expect((await move()).status).toBe(200)
  expect((await move(desktop)).status).toBe(409)
  expect((await read(context)).guide).toMatchObject({ seen: [0], version: 1 })
  expect((await read(context)).files.every((file) => !file.viewed)).toBe(true)
  await request(context, desktop, { ...initial.files[0], viewed: true })
  expect((await read(context)).guide?.seen).toEqual([0])
  runtime.services.store.updateTask('task', (task) => ({
    ...task,
    files: task.files.map((file) => ({ ...file, after: file.after + '\nchanged' })),
  }))
  expect((await read(context)).guide).toBeUndefined()
  expect((await move(desktop, 1)).status).toBe(409)
})

it('sends a held guide only as compact state across read, mark and move, and restores it in the session', async () => {
  const { runtime, read, desktop } = await setup()
  const context: ReviewContext = { kind: 'task', taskId: 'task', source: 'working' }
  const initial = await read(context)
  const step = (label: string, path: string) => ({
    label,
    summary: `${label} summary `.padEnd(2000, 's'),
    impact: `${label} impact `.padEnd(2000, 'i'),
    paths: [path],
    excerpts: [{ path, side: 'after', start: 1, end: 1 }],
    questions: Array.from({ length: 5 }, (_, index) =>
      `${label} question ${index} `.padEnd(500, 'q'),
    ),
  })
  vi.spyOn(runtime.services.titles, 'organizeReview').mockResolvedValue(
    JSON.stringify({ groups: [step('Contract', 'types.ts'), step('Caller', 'app.ts')] }),
  )
  const post = async (path: string, input: unknown) => {
    const response = await fetch(`http://127.0.0.1:${runtime.port}/api/review/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${desktop}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const text = await response.text()
    expect({ status: response.status, text }).toMatchObject({ status: 200 })
    return { bytes: text.length, progress: decode(reviewProgressSchema, JSON.parse(text)) }
  }
  const generated = await post('organize', {
    context,
    guided: true,
    revision: initial.revision,
    files: initial.files.map(({ path, fingerprint }) => ({ path, fingerprint })),
  })
  const guide = generated.progress.guide!
  // Generation stays complete, including its groups.
  expect(generated.progress.groups.map((group) => group.label)).toEqual(['Contract', 'Caller'])
  const full = await post('read', { context })
  expect(full.progress.guide).toEqual(guide)
  expect(full.progress.groups).toEqual([])
  const compact = await post('read', { context, knownGuide: guide.id })
  expect(compact.progress.guide).toBeUndefined()
  expect(compact.progress.guideState).toEqual({
    id: guide.id,
    revision: guide.revision,
    position: 0,
    seen: [],
    version: 0,
  })
  expect(full.bytes).toBeGreaterThan(13_000)
  expect(compact.bytes).toBeLessThan(1_000)
  // A different held guide still receives the complete one.
  expect((await post('read', { context, knownGuide: 'other' })).progress.guide).toEqual(guide)
  const marked = await post('set', {
    context,
    knownGuide: guide.id,
    ...initial.files[0],
    viewed: true,
  })
  expect(marked.progress.guideState?.version).toBe(0)
  expect(marked.progress.files.find((file) => file.path === initial.files[0].path)?.viewed).toBe(
    true,
  )
  const moved = await post('guide', {
    context,
    knownGuide: guide.id,
    move: { id: guide.id, version: 0, position: 1, reviewed: 0 },
  })
  expect(moved.progress.guideState).toMatchObject({ position: 1, seen: [0], version: 1 })
  expect(moved.bytes).toBeLessThan(1_000)

  // The session names its held guide only after receiving one, then restores steps and groups.
  const inputs: unknown[] = []
  const states: ReviewSessionState[] = []
  const session = createReviewSession(
    context,
    async (path, input) => {
      inputs.push(input)
      return (await post(path.slice('/api/review/'.length), input)).progress
    },
    (state) => states.push(state),
  )
  await session.refresh()
  await session.refresh()
  expect(inputs).toEqual([{ context }, { context, knownGuide: guide.id }])
  const restored = states.at(-1)?.progress
  expect(restored?.guide).toEqual({ ...guide, position: 1, seen: [0], version: 1 })
  expect(restored?.groups.map((group) => [group.label, group.paths, group.summary])).toEqual(
    guide.steps.map((step) => [step.title, step.paths, step.summary]),
  )
  expect(await session.moveGuide({ id: guide.id, version: 1, position: 0, reviewed: 1 })).toBe(true)
  expect(states.at(-1)?.progress?.guide).toEqual({
    ...guide,
    position: 0,
    seen: [0, 1],
    version: 2,
  })
  session.stop()
})

it('does not publish an older guided generation over a newer completed one', async () => {
  const { runtime, read } = await setup()
  const context: ReviewContext = { kind: 'task', taskId: 'task', source: 'working' }
  const initial = await read(context)
  const output = JSON.stringify({
    groups: [
      {
        label: 'Feature',
        summary: 'Changes both files',
        impact: 'Check caller',
        paths: ['types.ts', 'app.ts'],
      },
    ],
  })
  let finish!: (output: string) => void
  const model = vi
    .spyOn(runtime.services.titles, 'organizeReview')
    .mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve
        }),
    )
    .mockResolvedValue(output)
  const expected = initial.files.map(({ path, fingerprint }) => ({ path, fingerprint }))
  const first = runtime.services.fileReviews.organize(
    context,
    undefined,
    expected,
    runtime.services.titles,
    true,
    initial.revision,
  )
  await vi.waitFor(() => expect(model).toHaveBeenCalledTimes(1))
  const second = await runtime.services.fileReviews.organize(
    context,
    undefined,
    expected,
    runtime.services.titles,
    true,
    initial.revision,
  )
  const rejected = first.then(
    () => {
      throw new Error('The older generation unexpectedly succeeded')
    },
    (error: unknown) => {
      expect(error).toMatchObject({ status: 409 })
    },
  )
  finish(output)
  await rejected
  expect((await read(context)).guide?.id).toBe(second.guide?.id)
})

it('organizes a saved source independently of file ordering', async () => {
  const { runtime, read } = await setup()
  const context: ReviewContext = { kind: 'task', taskId: 'task', source: 'turn', turnId: 'turn' }
  const initial = await read(context)
  vi.spyOn(runtime.services.titles, 'organizeReview').mockResolvedValue(
    JSON.stringify({
      groups: [
        {
          label: 'Feature',
          summary: 'Updates value and caller',
          impact: 'Check callers',
          paths: ['types.ts', 'app.ts'],
        },
      ],
    }),
  )
  const result = await runtime.services.fileReviews.organize(
    context,
    undefined,
    initial.files.map(({ path, fingerprint }) => ({ path, fingerprint })),
    runtime.services.titles,
    true,
    initial.revision,
  )
  expect(result.guide?.steps[0].paths).toEqual(['types.ts', 'app.ts'])
})
