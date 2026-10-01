import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, rm, writeFile, mkdir, readFile, symlink, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
vi.setConfig(runtimeIntegration)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
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
    s.store.updateTask('task', (task) => ({
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
  f.runtime.services.store.updateTask('task', (task) => ({
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
