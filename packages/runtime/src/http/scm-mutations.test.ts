import { afterEach, expect, it, vi } from 'vite-plus/test'
import { readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startRuntime } from '../index.js'
import { fixture } from '../testing/fixture.js'
import { runtimeIntegration } from '../testing/integration.js'
import { Effect } from 'effect'
import { runClientEffect } from '@dovo/client-runtime'
import { withFileWrite } from '../scm/repositories/file-writes.js'
import type { AgentAdapter } from '../agents/execution/types.js'
import { decode, responses } from '@dovo/protocol'

vi.setConfig(runtimeIntegration)
const cleanups: Array<() => Promise<void>> = []
function barrier() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function setup() {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const token = 'scm-mutations-owner-token-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(runtime.close)
  runtime.services.store.update(() => f.workspace)
  const post = (path: string, input: Record<string, unknown>) =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ repositoryId: 'repo', ...input }),
    })
  const request = (operation: string, input: Record<string, unknown>) =>
    post(`/api/scm/${operation}`, input)
  return { ...f, s: runtime.services, cwd: await realpath(f.directory), request, post }
}

it('scans working metadata once for concurrent reads and loads only the selected file', async () => {
  const f = await setup()
  const task = f.s.tasks.create({
    title: 'Preview selected change',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
    execution: 'main',
  })
  await writeFile(join(f.cwd, 'hello.txt'), 'edited\n')
  await writeFile(join(f.cwd, 'other.txt'), 'another change\n')
  const command = vi.spyOn(f.s.git, 'command')
  const previews = vi.spyOn(f.s.git, 'workingFilePreview')
  await Promise.all([f.s.git.changes(f.cwd, false), f.s.git.changes(f.cwd, false)])
  expect(command.mock.calls.filter(([, args]) => args[0] === 'status')).toHaveLength(1)
  const refresh = { taskId: task.id, includeFiles: false, metadataOnly: true }
  expect((await f.request('changes', refresh)).status).toBe(200)
  expect(previews).not.toHaveBeenCalled()
  const load = { taskId: task.id, includeFiles: false, previewPath: 'hello.txt' }
  const statusReads = command.mock.calls.filter(([, args]) => args[0] === 'status').length
  expect((await f.request('changes', load)).status).toBe(200)
  expect(command.mock.calls.filter(([, args]) => args[0] === 'status')).toHaveLength(statusReads)
  expect(previews).toHaveBeenCalledTimes(1)
  expect(f.s.store.taskSummary(task.id).files).toEqual([
    expect.objectContaining({
      path: 'hello.txt',
      before: 'original\n',
      after: 'edited\n',
      diskContents: 'edited\n',
    }),
    expect.objectContaining({
      path: 'other.txt',
      after: '',
      preview: expect.objectContaining({ kind: 'deferred' }),
    }),
  ])
  expect((await f.request('changes', refresh)).status).toBe(200)
  expect(f.s.store.taskSummary(task.id).files[0].after).toBe('edited\n')
  expect((await f.request('changes', { ...load, previewPath: '../not-listed.txt' })).status).toBe(
    200,
  )
  expect(previews).toHaveBeenCalledTimes(1)
  await writeFile(join(f.cwd, 'other.txt'), 'changed after scan\n')
  expect((await f.request('changes', { ...load, previewPath: 'other.txt' })).status).toBe(200)
  expect(f.s.store.taskSummary(task.id).files[1].preview?.kind).toBe('deferred')
  expect(previews).toHaveBeenCalledTimes(1)
})

it('acknowledges background Changes refreshes after saving files and retains full replies for other callers', async () => {
  const f = await setup()
  const task = f.s.tasks.create({
    title: 'Changes',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
    execution: 'main',
  })
  await writeFile(join(f.cwd, 'hello.txt'), 'updated\n')
  const refresh = await f.request('changes', { taskId: task.id, includeFiles: false })
  expect(refresh.status).toBe(200)
  expect(decode(responses.changesRefresh, await refresh.json())).toEqual({ ok: true })
  expect(f.s.store.taskSummary(task.id).files[0]).toMatchObject({
    path: 'hello.txt',
    after: 'updated\n',
  })
  f.s.store.updateTask(task.id, (value) => ({
    ...value,
    files: value.files.map((file) => ({ ...file, viewed: true })),
  }))
  const before = f.s.store.taskSummary(task.id)
  await f.request('changes', { taskId: task.id, includeFiles: false })
  expect(f.s.store.taskSummary(task.id).files).toBe(before.files)
  expect(f.s.store.taskSummary(task.id).fileReviewVersions).toBe(before.fileReviewVersions)
  for (const includeFiles of [undefined, true]) {
    const response = await f.request('changes', { taskId: task.id, includeFiles })
    expect(response.status).toBe(200)
    const legacy = await response.json()
    expect(decode(responses.files, legacy).files).toEqual(before.files)
    expect(decode(responses.changesRefresh, legacy)).toEqual(legacy)
  }
  expect((await f.request('changes', { includeFiles: false })).status).toBe(400)
  expect((await f.request('changes', { taskId: task.id, includeFiles: 'false' })).status).toBe(400)
  const revision = f.s.store.version()
  await writeFile(join(f.cwd, 'hello.txt'), 'new edit\n')
  await f.request('changes', { taskId: task.id, includeFiles: false })
  expect(f.s.store.version()).toBeGreaterThan(revision)
  expect(f.s.store.taskSummary(task.id).files[0]).toMatchObject({
    after: 'new edit\n',
    viewed: false,
  })
})

it('guards read-only staging previews by repository and task without changing drafts or the index', async () => {
  const f = await setup()
  await writeFile(join(f.cwd, 'hello.txt'), 'indexed\n')
  await f.s.git.stage(f.cwd, ['hello.txt'])
  await writeFile(join(f.cwd, 'hello.txt'), 'working\n')
  const index = await readFile(join(f.cwd, '.git/index'))
  for (const comparison of ['staged', 'unstaged']) {
    const response = await f.request('file-preview', { path: 'hello.txt', comparison })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject(
      comparison === 'staged'
        ? { before: { text: 'original\n' }, after: { text: 'indexed\n' } }
        : { before: { text: 'indexed\n' }, after: { text: 'working\n' } },
    )
  }
  expect(await readFile(join(f.cwd, '.git/index'))).toEqual(index)
  expect(await readFile(join(f.cwd, 'hello.txt'), 'utf8')).toBe('working\n')
  const scoped = f.s.tasks.create({
    title: 'Scoped review',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Review',
    execution: 'main',
  })
  const scopedResponse = await f.request('file-preview', {
    taskId: scoped.id,
    path: 'hello.txt',
    comparison: 'unstaged',
  })
  expect(scopedResponse.status).toBe(200)
  expect(await scopedResponse.json()).toMatchObject({
    before: { text: 'indexed\n' },
    after: { text: 'working\n' },
  })
  expect(
    (await f.request('file-preview', { path: '../escape', comparison: 'staged' })).status,
  ).toBe(400)
  expect(
    (await f.request('file-preview', { path: 'hello.txt', comparison: 'combined' })).status,
  ).toBe(400)
  expect(
    (
      await f.request('file-preview', {
        repositoryId: 'missing',
        path: 'hello.txt',
        comparison: 'staged',
      })
    ).status,
  ).toBe(404)
  f.s.store.update((workspace) => ({
    ...workspace,
    repositories: [...workspace.repositories, { ...workspace.repositories[0], id: 'other' }],
  }))
  const task = f.s.tasks.create({
    title: 'Other project',
    repositoryId: 'other',
    agentId: 'agent',
    objective: 'Review',
  })
  expect(
    (await f.request('file-preview', { taskId: task.id, path: 'hello.txt', comparison: 'staged' }))
      .status,
  ).toBe(400)
})

it('rejects save, stage, unstage and commit during exclusive checkout operations, then allows recovery', async () => {
  const f = await setup()
  const head = await f.s.git.command(f.cwd, ['rev-parse', 'HEAD'])
  const save = { path: 'hello.txt', expected: 'original\n', contents: 'edited\n' }
  await f.s.tasks.withCheckoutMutation(f.cwd, async () => {
    expect((await f.request('apply', save)).status).toBe(409)
    expect((await f.request('stage', { paths: ['hello.txt'] })).status).toBe(409)
    expect((await f.request('unstage', { paths: ['hello.txt'] })).status).toBe(409)
    expect((await f.request('commit', { message: 'Blocked commit' })).status).toBe(409)
    expect(await readFile(join(f.cwd, 'hello.txt'), 'utf8')).toBe('original\n')
    expect(await f.s.git.command(f.cwd, ['diff', '--cached'])).toBe('')
    expect(await f.s.git.command(f.cwd, ['rev-parse', 'HEAD'])).toBe(head)
  })
  expect((await f.request('apply', save)).status).toBe(200)
  expect((await f.request('apply', save)).status).toBe(409)
  expect((await f.request('stage', { paths: ['hello.txt'] })).status).toBe(200)
  expect((await f.request('unstage', { paths: ['hello.txt'] })).status).toBe(200)
  expect(await f.s.git.command(f.cwd, ['diff', '--cached'])).toBe('')
  expect(await readFile(join(f.cwd, 'hello.txt'), 'utf8')).toBe('edited\n')
  expect((await f.request('unstage', { paths: ['../escape'] })).status).toBe(400)
  expect(
    (await f.request('unstage', { paths: Array.from({ length: 201 }, () => 'hello.txt') })).status,
  ).toBe(400)
  expect((await f.request('stage', { paths: ['hello.txt'] })).status).toBe(200)
  const committed = await f.request('commit', { message: 'Allowed commit' })
  expect(committed.status).toBe(200)
  expect(await f.s.git.command(f.cwd, ['show', 'HEAD:hello.txt'])).toBe('edited\n')
  expect(await f.s.git.command(f.cwd, ['rev-parse', 'HEAD'])).not.toBe(head)
})

it.skipIf(process.platform === 'win32')(
  'keeps excluded files out of the index after a failed commit and retry',
  async () => {
    const f = await setup()
    await writeFile(join(f.cwd, 'hello.txt'), 'included\n')
    await writeFile(join(f.cwd, 'excluded.txt'), 'excluded\n')
    expect((await f.request('stage', { paths: ['hello.txt'] })).status).toBe(200)
    const hook = join(f.cwd, '.git/hooks/pre-commit')
    await writeFile(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    expect((await f.request('commit', { message: 'Try again after the hook' })).ok).toBe(false)
    expect(await f.s.git.command(f.cwd, ['diff', '--cached', '--name-only'])).toBe('hello.txt\n')
    expect(await readFile(join(f.cwd, 'excluded.txt'), 'utf8')).toBe('excluded\n')
    await rm(hook)
    expect((await f.request('commit', { message: 'Commit the selected change' })).status).toBe(200)
    expect(await f.s.git.command(f.cwd, ['show', '--format=', '--name-only', 'HEAD'])).toBe(
      'hello.txt\n',
    )
  },
)

it('unstages a partially staged path before the first commit without touching other index or working contents', async () => {
  const f = await setup()
  await f.s.git.command(f.cwd, ['checkout', '--orphan', 'unborn-route'])
  await writeFile(join(f.cwd, 'added.txt'), 'staged\n')
  await f.s.git.stage(f.cwd, ['added.txt'])
  await writeFile(join(f.cwd, 'added.txt'), 'working\n')
  expect((await f.request('unstage', { paths: [] })).status).toBe(200)
  expect(await f.s.git.command(f.cwd, ['show', ':added.txt'])).toBe('staged\n')
  expect((await f.request('unstage', { paths: ['added.txt'] })).status).toBe(200)
  expect((await f.s.git.command(f.cwd, ['ls-files'])).trim()).toBe('hello.txt')
  expect(await f.s.git.command(f.cwd, ['show', ':hello.txt'])).toBe('original\n')
  expect(await readFile(join(f.cwd, 'added.txt'), 'utf8')).toBe('working\n')
})

it('keeps explicit editing available during an agent run while excluding branch operations', async () => {
  const f = await setup()
  const started = barrier()
  const finish = barrier()
  vi.spyOn(f.s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async () => {
      started.resolve()
      await finish.promise
    },
  })
  const task = f.s.tasks.create({
    title: 'Editing',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Work',
    execution: 'main',
  })
  const run = await f.s.tasks.start(task.id)
  try {
    await started.promise
    expect(
      (
        await f.request('apply', {
          path: 'hello.txt',
          expected: 'original\n',
          contents: 'edited during run\n',
        })
      ).status,
    ).toBe(200)
    await expect(f.s.tasks.withCheckoutMutation(f.cwd, async () => {})).rejects.toThrow(
      'running agent',
    )
  } finally {
    finish.resolve()
    await run.done
  }
})

it('admits runs and other edits during an explicit edit while excluding checkout switches', async () => {
  const f = await setup()
  vi.spyOn(f.s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      run.onText('Finished beside an edit')
    },
  })
  const task = f.s.tasks.create({
    title: 'Concurrent editing',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Work',
    execution: 'main',
  })
  await runClientEffect(
    f.s.tasks.withCheckoutEditEffect(
      f.cwd,
      Effect.promise(async () => {
        await expect(f.s.tasks.withCheckoutMutation(f.cwd, async () => {})).rejects.toThrow(
          'checkout operation',
        )
        expect(
          (
            await f.request('apply', {
              path: 'hello.txt',
              expected: 'original\n',
              contents: 'shared edit\n',
            })
          ).status,
        ).toBe(200)
        await (
          await f.s.tasks.start(task.id)
        ).done
        expect(f.s.store.task(task.id).status).toBe('review')
      }),
    ),
  )
  await f.s.tasks.withCheckoutMutation(f.cwd, async () => {})
  await expect(
    runClientEffect(f.s.tasks.withCheckoutEditEffect(f.cwd, Effect.fail(new Error('failed edit')))),
  ).rejects.toThrow('failed edit')
  await f.s.tasks.withCheckoutMutation(f.cwd, async () => {})
})

it('protects editor and instructions saves and serializes competing routes to the same file', async () => {
  const f = await setup()
  const task = f.s.tasks.create({
    title: 'Editor',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
    execution: 'main',
  })
  const filename = join(f.cwd, 'AGENTS.md')
  await writeFile(filename, 'Original instructions')
  const version = (await (await f.request('instructions/read', { name: 'AGENTS.md' })).json())
    .version
  const editor = (contents: string) =>
    f.post('/api/tasks/files/write', {
      id: task.id,
      path: 'AGENTS.md',
      expectedContents: 'Original instructions',
      contents,
    })
  const instructions = () =>
    f.request('instructions/save', { name: 'AGENTS.md', version, text: 'Instructions editor' })
  await f.s.tasks.withCheckoutMutation(f.cwd, async () => {
    expect((await editor('Blocked')).status).toBe(409)
    expect((await instructions()).status).toBe(409)
    expect(await readFile(filename, 'utf8')).toBe('Original instructions')
  })
  const entered = barrier()
  const release = barrier()
  const held = withFileWrite(filename, async () => {
    entered.resolve()
    await release.promise
  })
  await entered.promise
  // Both requests must reread after per-file admission, including across editor routes.
  const responses = Promise.all([
    editor('Task editor'),
    instructions(),
    f.request('apply', {
      path: 'AGENTS.md',
      expected: 'Original instructions',
      contents: 'SCM editor',
    }),
  ])
  release.resolve()
  try {
    expect((await responses).map((response) => response.status).sort((a, b) => a - b)).toEqual([
      200, 409, 409,
    ])
    expect(['Task editor', 'Instructions editor', 'SCM editor']).toContain(
      await readFile(filename, 'utf8'),
    )
  } finally {
    release.resolve()
    await held
  }
})
