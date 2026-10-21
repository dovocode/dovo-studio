import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, rm, writeFile, mkdir, readFile, symlink, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  SCRATCH_PROJECT_ID,
  defaultTaskHarness,
  decode,
  snapshotSchema,
  repositorySchema,
  type Task,
} from '@dovo/protocol'
import { startRuntime } from '../index'
import type { AgentAdapter, AgentRun } from '../agents/execution/types'
import { runtimeIntegration } from '../testing/integration'
import { Effect } from 'effect'
vi.setConfig(runtimeIntegration)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
const token = 'projectless-owner-token-at-least-32-characters'
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'dovo-projectless-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const databasePath = join(root, 'runtime.sqlite')
  const runtime = await startRuntime({ databasePath, ownerToken: token, port: 0 })
  cleanups.push(runtime.close)
  const request = (path: string, input?: unknown, method = 'POST') =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: input === undefined ? undefined : JSON.stringify(input),
    })
  const draft = (id: string, repositoryId = SCRATCH_PROJECT_ID): Task => ({
    id,
    repositoryId,
    title: 'New task',
    agentId: '',
    harness: defaultTaskHarness('codex'),
    execution: 'main',
    status: 'draft',
    createdAt: new Date().toISOString(),
    messages: [],
    files: [],
    draft: '',
    example: false,
  })
  const create = async (task: Task) => {
    const response = await request(
      '/api/workspace',
      { collection: 'tasks', id: task.id, create: task, changes: {} },
      'PATCH',
    )
    expect(response.status).toBe(200)
  }
  return { root, runtime, request, draft, create, databasePath }
}
async function registerFolder(f: Awaited<ReturnType<typeof setup>>, path: string) {
  const response = await f.request('/api/scm/repositories/add', {
    source: 'local',
    name: 'Plain project',
    path,
  })
  expect(response.status).toBe(200)
  const repository = decode(repositorySchema, await response.json())
  expect(repository.kind).toBe('folder')
  return repository
}
it('creates named Dovo projects with separate managed folders and shares files between their chats across restarts', async () => {
  const f = await setup()
  vi.stubEnv('DOVO_DATA_ROOT', f.root)
  const create = async (name: string) => {
    const response = await f.request('/api/scm/repositories/add', { source: 'dovo', name })
    expect(response.status).toBe(200)
    return decode(repositorySchema, await response.json())
  }
  const [project, duplicate, escaped] = await Promise.all([
    create(' My notes '),
    create('My notes'),
    create('../../研究\\notes'),
  ])
  const root = join(await realpath(f.root), 'projects')
  expect(project).toMatchObject({ name: 'My notes', kind: 'folder', branch: '' })
  expect(project.path).toMatch(/my-notes-[a-zA-Z0-9]+$/)
  expect(duplicate.id).not.toBe(project.id)
  expect(duplicate.path).not.toBe(project.path)
  for (const item of [project, duplicate, escaped]) {
    expect(dirname(item.path)).toBe(root)
    expect(await realpath(item.path)).toBe(item.path)
    expect(await f.runtime.services.git.isRepository(item.path)).toBe(false)
  }
  await f.create(f.draft('notes-one', project.id))
  await f.create(f.draft('notes-two', project.id))
  const first = await f.runtime.services.checkouts.directory('notes-one')
  expect(await f.runtime.services.checkouts.directory('notes-two')).toBe(first)
  expect(first).toBe(project.path)
  await writeFile(join(first, 'notes.txt'), 'Shared notes')
  const files = await f.request('/api/tasks/files/list', { id: 'notes-two' })
  expect(await files.json()).toEqual({ files: ['notes.txt'] })
  await f.runtime.close()
  const reopened = await startRuntime({ databasePath: f.databasePath, ownerToken: token, port: 0 })
  cleanups.push(reopened.close)
  expect(reopened.services.store.get().repositories.find((item) => item.id === project.id)).toEqual(
    project,
  )
  expect(await reopened.services.checkouts.directory('notes-one')).toBe(project.path)
  expect(await readFile(join(project.path, 'notes.txt'), 'utf8')).toBe('Shared notes')
})
it('rejects empty Dovo project names and managed folders inside a Git checkout', async () => {
  const f = await setup()
  vi.stubEnv('DOVO_DATA_ROOT', f.root)
  const invalid = await f.request('/api/scm/repositories/add', { source: 'dovo', name: ' ' })
  expect(invalid.status).toBe(400)
  await f.runtime.services.git.command(f.root, ['init', '-q'])
  const nested = await f.request('/api/scm/repositories/add', { source: 'dovo', name: 'Notes' })
  expect(nested.status).toBe(409)
  expect(f.runtime.services.store.get().repositories).toEqual([])
})
it('deletes a project history while preserving repository and checkout files, and rejects General or active work', async () => {
  const f = await setup()
  const repositoryPath = join(f.root, 'deletable-project')
  await mkdir(repositoryPath)
  await f.runtime.services.git.command(repositoryPath, ['init', '-q'])
  await f.runtime.services.git.command(repositoryPath, ['config', 'user.email', 'fixture@test'])
  await f.runtime.services.git.command(repositoryPath, ['config', 'user.name', 'Fixture'])
  await writeFile(join(repositoryPath, 'tracked.txt'), 'tracked')
  await f.runtime.services.git.command(repositoryPath, ['add', 'tracked.txt'])
  await f.runtime.services.git.command(repositoryPath, ['commit', '-qm', 'fixture'])
  const added = await f.request('/api/scm/repositories/add', {
    source: 'local',
    name: 'Deletable project',
    path: repositoryPath,
  })
  expect(added.status).toBe(200)
  const repository = decode(repositorySchema, await added.json())
  const projectTask = {
    ...f.draft('project-thread', repository.id),
    execution: 'worktree' as const,
    messages: [{ id: 'project-thread', role: 'user' as const, text: 'fixture prompt' }],
  }
  const unrelatedTask = f.draft('unrelated-thread')
  await Promise.all([f.create(projectTask), f.create(unrelatedTask)])
  const checkout = await f.runtime.services.checkouts.directory(projectTask.id)
  f.runtime.services.store.update((workspace) => ({
    ...workspace,
    tasks: workspace.tasks.map((task) =>
      task.id === unrelatedTask.id
        ? {
            ...task,
            linkedCheckouts: [
              {
                id: 'deleted-project-link',
                repositoryId: repository.id,
                execution: 'main' as const,
                access: 'read-only' as const,
              },
            ],
          }
        : task,
    ),
  }))
  f.runtime.services.db
    .prepare('INSERT INTO artifact_feeds VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('fixture-publication', projectTask.id, 'fixture-artifact', 1, 'owner', null, 0, '')
  await writeFile(join(repositoryPath, 'keep.txt'), 'repository stays')
  await writeFile(join(checkout, 'keep.txt'), 'checkout stays')
  expect(checkout).not.toBe(repositoryPath)
  f.runtime.services.preferences.save({ removeWorktreesOnThreadDelete: true })
  const general = await f.request('/api/scm/repositories/delete', {
    repositoryId: SCRATCH_PROJECT_ID,
  })
  expect(general.status).toBe(409)
  f.runtime.services.store.update((workspace) => ({
    ...workspace,
    tasks: workspace.tasks.map((task) =>
      task.id === projectTask.id ? { ...task, status: 'running' as const } : task,
    ),
  }))
  const active = await f.request('/api/scm/repositories/delete', { repositoryId: repository.id })
  expect(active.status).toBe(409)
  f.runtime.services.store.update((workspace) => ({
    ...workspace,
    tasks: workspace.tasks.map((task) =>
      task.id === projectTask.id ? { ...task, status: 'draft' as const } : task,
    ),
  }))
  const stopFeeds = f.runtime.services.artifactFeeds.stopTasks.bind(
    f.runtime.services.artifactFeeds,
  )
  let signalReached!: () => void
  let releaseDeletion!: () => void
  const reachedStopFeeds = new Promise<void>((resolve) => (signalReached = resolve))
  const deletionGate = new Promise<void>((resolve) => (releaseDeletion = resolve))
  vi.spyOn(f.runtime.services.artifactFeeds, 'stopTasks').mockImplementation(async (ids) => {
    signalReached()
    await deletionGate
    await stopFeeds(ids)
  })
  const deleting = f.request('/api/scm/repositories/delete', { repositoryId: repository.id })
  await reachedStopFeeds
  try {
    const concurrentMessage = await f.request('/api/tasks/message', {
      id: projectTask.id,
      messageId: 'during-project-deletion',
      text: 'Start a new turn',
    })
    expect(concurrentMessage.status).toBe(409)
    await expect(
      Effect.runPromise(f.runtime.services.tasks.startEffect(projectTask.id)),
    ).rejects.toThrow('This thread is being deleted.')
    const concurrentCreate = await f.request(
      '/api/workspace',
      {
        collection: 'tasks',
        id: 'late-project-thread',
        create: f.draft('late-project-thread', repository.id),
        changes: {},
      },
      'PATCH',
    )
    expect(concurrentCreate.status).toBe(409)
    const concurrentReassign = await f.request(
      '/api/workspace',
      {
        collection: 'tasks',
        id: unrelatedTask.id,
        changes: { repositoryId: { before: SCRATCH_PROJECT_ID, after: repository.id } },
      },
      'PATCH',
    )
    expect(concurrentReassign.status).toBe(409)
  } finally {
    releaseDeletion()
  }
  const response = await deleting
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ ok: true })
  expect(
    f.runtime.services.store.get().repositories.some((item) => item.id === repository.id),
  ).toBe(false)
  const remainingTask = f.runtime.services.store.get().tasks[0]!
  expect(remainingTask.id).toBe(unrelatedTask.id)
  expect(remainingTask.linkedCheckouts).toEqual([])
  expect(
    f.runtime.services.db
      .prepare('SELECT publication FROM artifact_feeds WHERE publication=?')
      .get('fixture-publication'),
  ).toBeUndefined()
  expect(await readFile(join(repositoryPath, 'keep.txt'), 'utf8')).toBe('repository stays')
  expect(await readFile(join(checkout, 'keep.txt'), 'utf8')).toBe('checkout stays')
})
it('offers No project on an empty server and isolates files per thread, preserving them across restarts and deletion', async () => {
  const f = await setup()
  const snapshot = decode(
    snapshotSchema,
    await (await f.request('/api/snapshot', undefined, 'GET')).json(),
  )
  expect(snapshot.workspace.repositories.find((repo) => repo.id === SCRATCH_PROJECT_ID)?.kind).toBe(
    'scratch',
  )
  expect(f.runtime.services.store.get().repositories).toEqual([])
  await Promise.all([f.create(f.draft('../../one')), f.create(f.draft('two'))])
  const s = f.runtime.services
  const [one, two] = await Promise.all([
    s.checkouts.directory('../../one'),
    s.checkouts.directory('two'),
  ])
  expect(one).not.toBe(two)
  expect(one.startsWith(join(await realpath(f.root), 'scratch') + '/')).toBe(true)
  await writeFile(join(one, 'hello.txt'), 'Preserved')
  const files = await f.request('/api/tasks/files/list', { id: '../../one' })
  expect(await files.json()).toEqual({ files: ['hello.txt'] })
  expect(await (await f.request('/api/tasks/files/list', { id: 'two' })).json()).toEqual({
    files: [],
  })
  await f.runtime.close()
  const reopened = await startRuntime({ databasePath: f.databasePath, ownerToken: token, port: 0 })
  cleanups.push(reopened.close)
  expect(await reopened.services.checkouts.directory('../../one')).toBe(one)
  const deleted = await fetch(`http://127.0.0.1:${reopened.port}/api/tasks/lifecycle`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: '../../one', action: 'delete' }),
  })
  expect(deleted.status).toBe(200)
  expect(await readFile(join(one, 'hello.txt'), 'utf8')).toBe('Preserved')
})
it.each(['scratch', 'folder'] as const)(
  'runs and resumes %s threads without Git inspection, diffs, or checkpoints',
  async (kind) => {
    const f = await setup()
    let repositoryId = SCRATCH_PROJECT_ID
    if (kind === 'folder') {
      const folder = join(f.root, 'plain-folder')
      await mkdir(folder)
      repositoryId = (await registerFolder(f, folder)).id
    }
    await f.create(f.draft('task', repositoryId))
    const s = f.runtime.services
    const runs: AgentRun[] = []
    vi.spyOn(s.agents, 'get').mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run: async (run) => {
        runs.push(run)
        run.onSession('persistent-session')
        await writeFile(join(run.cwd, 'output.txt'), 'Result')
        run.onText('Done')
      },
    })
    const inspect = vi.spyOn(s.git, 'inspect')
    const checkpoint = vi.spyOn(s.git, 'snapshot')
    s.store.updateTaskHistory('task', (task) => ({
      ...task,
      messages: [{ id: 'first', role: 'user', text: 'Hello', createdAt: new Date().toISOString() }],
    }))
    await (
      await s.tasks.start('task')
    ).done
    await s.tasks.send('task', 'second', 'Follow up')
    // send acknowledges startup; await its worker through a short state poll.
    for (let i = 0; i < 200 && s.store.task('task').status === 'running'; i++)
      await new Promise((resolve) => setTimeout(resolve, 10))
    expect(s.store.task('task').status).toBe('review')
    expect(runs).toHaveLength(2)
    expect(runs[1].cwd).toBe(runs[0].cwd)
    expect(runs[1].sessionId).toBe('persistent-session')
    expect(inspect).not.toHaveBeenCalled()
    expect(checkpoint).not.toHaveBeenCalled()
    expect(s.store.task('task').files).toEqual([])
    expect(s.store.task('task').turns?.every((turn) => !turn.checkpoint && !turn.branch)).toBe(true)
    expect(await (await f.request('/api/tasks/files/list', { id: 'task' })).json()).toEqual({
      files: ['output.txt'],
    })
  },
)
it('rejects Git settings and managed-project edits and does not follow scratch folder symlinks', async () => {
  const f = await setup()
  expect(
    (
      await f.request(
        '/api/workspace',
        {
          collection: 'tasks',
          id: 'bad',
          create: { ...f.draft('bad'), execution: 'worktree' },
          changes: {},
        },
        'PATCH',
      )
    ).status,
  ).toBe(400)
  await f.create(f.draft('task'))
  expect(
    (
      await f.request(
        '/api/workspace',
        {
          collection: 'repositories',
          id: SCRATCH_PROJECT_ID,
          changes: { path: { before: f.runtime.services.scratch.root, after: f.root } },
        },
        'PATCH',
      )
    ).status,
  ).toBe(400)
  const path = await f.runtime.services.checkouts.directory('task')
  await rm(path, { recursive: true })
  await symlink(f.root, path)
  await expect(f.runtime.services.checkouts.directory('task')).rejects.toThrow('managed workspace')
  await f.runtime.close()
  const reopened = await startRuntime({ databasePath: f.databasePath, ownerToken: token, port: 0 })
  cleanups.push(reopened.close)
  await expect(reopened.services.checkouts.directory('task')).rejects.toThrow('managed workspace')
})

it('withholds scratch threads inside a Git checkout and keeps plain-folder defaults out of worktree mode', async () => {
  const f = await setup()
  await f.runtime.services.git.command(f.root, ['init', '-q'])
  const response = await f.request('/api/snapshot', undefined, 'GET')
  const snapshot = decode(snapshotSchema, await response.json())
  expect(snapshot.workspace.repositories.some((repo) => repo.kind === 'scratch')).toBe(false)
  const plain = { id: 'folder', name: 'Folder', path: f.root, branch: '', kind: 'folder' as const }
  f.runtime.services.store.update((workspace) => ({ ...workspace, repositories: [plain] }))
  f.runtime.services.defaults.save({
    execution: 'worktree',
    setupCommand: 'exit 1',
    worktreeFromOrigin: true,
  })
  const defaults = f.runtime.services.store.taskDefaults('folder')
  expect(defaults.execution).toBe('main')
  expect(defaults.setupCommand).toBeUndefined()
  expect(defaults.worktreeFromOrigin).toBe(false)
})

it('recovers a scratch turn interrupted after the provider completed without requiring Git change capture', async () => {
  const f = await setup()
  await f.create(f.draft('task'))
  f.runtime.services.store.updateTaskHistory('task', (task) => ({
    ...task,
    status: 'review',
    runPhase: 'finalizing',
    messages: [{ id: 'input', role: 'user', text: 'Hello', createdAt: new Date().toISOString() }],
    turns: [
      {
        id: 'turn',
        assistantId: 'answer',
        agentId: 'codex',
        provider: 'codex',
        model: '',
        status: 'completed',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      },
    ],
  }))
  await f.runtime.close()
  const reopened = await startRuntime({ databasePath: f.databasePath, ownerToken: token, port: 0 })
  cleanups.push(reopened.close)
  const git = vi.spyOn(reopened.services.git, 'snapshot')
  await (
    await reopened.services.tasks.start('task')
  ).done
  expect(reopened.services.store.task('task').status).toBe('review')
  expect(reopened.services.store.task('task').runPhase).toBeUndefined()
  expect(git).not.toHaveBeenCalled()
})
