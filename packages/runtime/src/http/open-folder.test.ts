import { randomBytes } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { fixture } from '../testing/fixture'
import { startRuntime } from '../index'
import { HttpError } from '../errors'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

it('opens the selected repository or task checkout and returns validation and launch errors', async () => {
  const project = await fixture()
  cleanups.push(project.cleanup)
  const token = randomBytes(32).toString('base64url')
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(() => runtime.close())
  runtime.services.store.update(() => ({
    ...project.workspace,
    tasks: [
      {
        id: 'task',
        title: 'Task',
        repositoryId: 'repo',
        execution: 'worktree',
        agentId: 'agent',
        status: 'review',
        createdAt: new Date().toISOString(),
        messages: [],
        files: [],
        draft: '',
        example: false,
      },
    ],
  }))
  const launch = vi.spyOn(runtime.services.git, 'openFolder').mockResolvedValue(undefined)
  const checkout = vi
    .spyOn(runtime.services.checkouts, 'directory')
    .mockResolvedValue(project.directory + '/task-worktree')
  const request = (body: unknown, credential = token) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/scm/open-folder`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  expect(
    (await request({ repositoryId: 'repo', target: 'explorer' }, 'invalid-token')).status,
  ).toBe(401)
  expect(launch).not.toHaveBeenCalled()
  const explorer = await request({ repositoryId: 'repo', target: 'explorer' })
  expect(explorer.status).toBe(200)
  expect(await explorer.json()).toEqual({ ok: true })
  expect(launch).toHaveBeenLastCalledWith(project.directory, 'explorer')
  expect(checkout).not.toHaveBeenCalled()
  const editor = await request({ repositoryId: 'repo', taskId: 'task', target: 'vscode' })
  expect(editor.status).toBe(200)
  expect(checkout).toHaveBeenCalledWith('task')
  expect(launch).toHaveBeenLastCalledWith(project.directory + '/task-worktree', 'vscode')
  for (const target of ['zed', 'webstorm', 'idea']) {
    expect((await request({ repositoryId: 'repo', taskId: 'task', target })).status).toBe(200)
    expect(launch).toHaveBeenLastCalledWith(project.directory + '/task-worktree', target)
  }
  expect((await request({ repositoryId: 'repo', target: 'shell-command' })).status).toBe(400)
  expect(launch).toHaveBeenCalledTimes(5)
  launch.mockRejectedValueOnce(new HttpError(400, 'VS Code was not found'))
  const missing = await request({ repositoryId: 'repo', target: 'vscode' })
  expect(missing.status).toBe(400)
  expect(await missing.json()).toEqual({ error: 'VS Code was not found' })
})

it('authenticates installed-app discovery and returns a fresh runtime result without launching apps', async () => {
  const token = randomBytes(32).toString('base64url')
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(() => runtime.close())
  const detect = vi
    .spyOn(runtime.services.git, 'openTargets')
    .mockResolvedValueOnce({ targets: ['file-manager', 'zed', 'webstorm'] })
    .mockResolvedValueOnce({ targets: ['zed'] })
  const launch = vi.spyOn(runtime.services.git, 'openFolder')
  const request = (credential = token) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/scm/open-targets`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
  expect((await request('invalid-token')).status).toBe(401)
  expect(detect).not.toHaveBeenCalled()
  const first = await request()
  expect(first.status).toBe(200)
  expect(await first.json()).toEqual({ targets: ['file-manager', 'zed', 'webstorm'] })
  expect(await (await request()).json()).toEqual({ targets: ['zed'] })
  expect(detect).toHaveBeenCalledTimes(2)
  expect(launch).not.toHaveBeenCalled()
  detect.mockRejectedValueOnce(new HttpError(500, 'Detection unavailable'))
  const failure = await request()
  expect(failure.status).toBe(500)
  expect(await failure.json()).toEqual({ error: 'Detection unavailable' })
})
