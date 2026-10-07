import { afterEach, expect, it, vi } from 'vite-plus/test'
import { SCRATCH_PROJECT_ID, type Task } from '@dovo/protocol'
import { startRuntime } from '../index'
import { fixture } from '../testing/fixture'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.restoreAllMocks()
})
const token = 'admission-owner-token-at-least-32-characters'
function deferred() {
  let resolve = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
async function setup(empty = false) {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(runtime.close)
  const task: Task = {
    id: 'task',
    title: 'Draft',
    repositoryId: 'repo',
    agentId: '',
    status: 'draft',
    createdAt: new Date().toISOString(),
    messages: [],
    files: [],
    draft: 'Transferred text',
    example: false,
  }
  if (!empty) runtime.services.store.update(() => ({ ...f.workspace, tasks: [task] }))
  const post = (path: string, input: unknown) =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  return { ...f, runtime, task, post, s: runtime.services }
}

it('preserves workspace data created while import is discovering the scratch project', async () => {
  const { s, post, workspace, directory } = await setup(true)
  const entered = deferred()
  const release = deferred()
  cleanups.push(async () => release.resolve())
  vi.spyOn(s.scratch, 'available').mockImplementation(async () => {
    entered.resolve()
    await release.promise
    return {
      id: SCRATCH_PROJECT_ID,
      name: 'No project',
      kind: 'scratch',
      path: directory,
      branch: '',
    }
  })
  const pending = post('/api/workspace/import', {
    ...workspace,
    repositories: [
      { id: SCRATCH_PROJECT_ID, name: 'No project', kind: 'scratch', path: directory, branch: '' },
    ],
  })
  await entered.promise
  s.store.update(() => workspace)
  release.resolve()
  expect((await pending).status).toBe(409)
  expect(s.store.get().repositories).toEqual(workspace.repositories)
  expect(s.store.get().agents).toEqual(workspace.agents)
})

it.each(['draft', 'attachments', 'started', 'repository'] as const)(
  'preserves a source draft whose %s changed while verifying Git identity',
  async (change) => {
    const { s, task, post } = await setup()
    const entered = deferred()
    const release = deferred()
    cleanups.push(async () => release.resolve())
    vi.spyOn(s.git, 'repositoryIdentity').mockImplementation(async () => {
      entered.resolve()
      await release.promise
      return 'github.com/test/project'
    })
    const pending = post('/api/tasks/draft-moved', {
      id: task.id,
      repositoryId: task.repositoryId,
      draft: task.draft,
      gitIdentity: 'github.com/test/project',
    })
    await entered.promise
    if (change === 'repository')
      s.store.update((workspace) => ({
        ...workspace,
        repositories: workspace.repositories.map((repo) => ({
          ...repo,
          path: `${repo.path}/other`,
        })),
      }))
    else
      s.store.updateTask(task.id, (current) => ({
        ...current,
        ...(change === 'draft' ? { draft: 'New unsent work' } : {}),
        ...(change === 'attachments'
          ? {
              draftAttachments: [
                {
                  id: '00000000-0000-4000-8000-000000000001',
                  name: 'new.txt',
                  mime: 'text/plain',
                  size: 1,
                },
              ],
            }
          : {}),
        ...(change === 'started'
          ? { messages: [{ id: 'sent', role: 'user' as const, text: 'Start' }] }
          : {}),
      }))
    release.resolve()
    expect((await pending).status).toBe(409)
    expect(s.store.task(task.id).archivedAt).toBeUndefined()
  },
)

it.each(['/api/terminals', '/api/terminals/ensure', '/api/terminals/run'])(
  'does not spawn through %s after the task was deleted during checkout resolution',
  async (path) => {
    const { s, task, post, directory } = await setup()
    const entered = deferred()
    const release = deferred()
    cleanups.push(async () => release.resolve())
    vi.spyOn(s.checkouts, 'selectedDirectory').mockImplementation(async () => {
      entered.resolve()
      await release.promise
      return directory
    })
    const create = vi.spyOn(s.terminals, 'create')
    const input = vi.spyOn(s.terminals, 'input')
    const pending = post(path, {
      taskId: task.id,
      ...(path.endsWith('/run') ? { command: 'echo unexpected' } : {}),
    })
    await entered.promise
    expect((await post('/api/tasks/lifecycle', { id: task.id, action: 'delete' })).status).toBe(200)
    release.resolve()
    expect((await pending).status).toBe(404)
    expect(create).not.toHaveBeenCalled()
    expect(input).not.toHaveBeenCalled()
    expect(s.terminals.list()).toEqual([])
  },
)

it.each(['archived', 'repository', 'linked', 'inherited'] as const)(
  'does not spawn when the %s checkout state changed while opening a terminal',
  async (change) => {
    const { s, task, post, directory } = await setup()
    const checkoutId = change === 'linked' ? 'linked' : undefined
    if (change === 'linked')
      s.store.updateTask(task.id, (current) => ({
        ...current,
        linkedCheckouts: [
          { id: 'linked', repositoryId: 'repo', execution: 'main', access: 'edit' },
        ],
      }))
    if (change === 'inherited')
      s.store.update((workspace) => ({
        ...workspace,
        tasks: [
          ...workspace.tasks,
          {
            ...task,
            id: 'child',
            delegation: {
              parentTaskId: task.id,
              parentRunId: 'parent-run',
              key: 'child',
            },
          },
        ],
      }))
    const entered = deferred()
    const release = deferred()
    cleanups.push(async () => release.resolve())
    vi.spyOn(s.checkouts, 'selectedDirectory').mockImplementation(async () => {
      entered.resolve()
      await release.promise
      return directory
    })
    const create = vi.spyOn(s.terminals, 'create')
    const pending = post('/api/terminals/ensure', {
      taskId: change === 'inherited' ? 'child' : task.id,
      checkoutId,
    })
    await entered.promise
    if (change === 'archived')
      await post('/api/tasks/lifecycle', { id: task.id, action: 'archive' })
    else if (change === 'linked')
      s.store.updateTask(task.id, (current) => ({ ...current, linkedCheckouts: [] }))
    else
      s.store.update((workspace) => ({
        ...workspace,
        repositories: workspace.repositories.map((repo) => ({
          ...repo,
          path: `${repo.path}/other`,
        })),
      }))
    release.resolve()
    expect([404, 409]).toContain((await pending).status)
    expect(create).not.toHaveBeenCalled()
  },
)
