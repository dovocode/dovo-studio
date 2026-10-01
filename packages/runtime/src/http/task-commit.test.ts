import { afterEach, expect, it, vi } from 'vite-plus/test'
import { Effect } from 'effect'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { startRuntime } from '../index'
import { runtimeFailure } from '../errors'
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanup.splice(0).reverse()) await close()
})
async function setup() {
  const path = await mkdtemp(join(tmpdir(), 'dovo-auto-commit-'))
  cleanup.push(() => rm(path, { recursive: true, force: true }))
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: path, encoding: 'utf8' }).trim()
  git('init', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  await writeFile(join(path, 'file.txt'), 'Before\n')
  git('add', '.')
  git('commit', '-m', 'Initial')
  await writeFile(join(path, 'file.txt'), 'After\n')
  const token = 'commit-test-owner-token-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanup.push(runtime.close)
  runtime.services.store.update((workspace) => ({
    ...workspace,
    repositories: [{ id: 'repo', name: 'Repo', path, branch: 'main' }],
    tasks: [
      {
        id: 'task',
        title: 'Task',
        agentId: '',
        repositoryId: 'repo',
        execution: 'main',
        status: 'review',
        createdAt: '',
        messages: [],
        files: [],
        draft: '',
        example: false,
      },
    ],
  }))
  const generate = vi
    .spyOn(runtime.services.titles, 'commitMessageEffect')
    .mockReturnValue(Effect.succeed({ message: 'Update fixture' }))
  const push = vi.spyOn(runtime.services.git, 'push').mockResolvedValue(undefined)
  const commit = (input: { message?: string; push?: boolean } = { push: true }) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/tasks/commit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'task', ...input }),
    })
  return { runtime, path, git, generate, push, commit }
}
it('generates with the title service, commits the actual checkout and pushes automatically', async () => {
  const { git, generate, push, commit } = await setup()
  const response = await commit()
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ commit: expect.any(String) })
  expect(generate).toHaveBeenCalledWith({ id: 'task', diff: expect.stringContaining('+After') })
  expect(git('log', '-1', '--format=%s')).toBe('Update fixture')
  expect(git('status', '--porcelain')).toBe('')
  expect(push).toHaveBeenCalledOnce()
})
it('keeps manual messages and reports a failed push without losing the successful commit', async () => {
  const { git, generate, push, commit } = await setup()
  push.mockRejectedValue(new Error('Remote unavailable'))
  const response = await commit({ message: 'Manual message', push: true })
  expect(await response.json()).toMatchObject({
    commit: expect.any(String),
    pushError: 'Remote unavailable',
  })
  expect(git('log', '-1', '--format=%s')).toBe('Manual message')
  expect(generate).not.toHaveBeenCalled()
})
it('does not commit or push when message generation fails', async () => {
  const { git, generate, push, commit } = await setup()
  generate.mockReturnValue(Effect.fail(runtimeFailure(new Error('Generation failed'))))
  expect((await commit()).status).toBe(500)
  expect(git('log', '-1', '--format=%s')).toBe('Initial')
  expect(push).not.toHaveBeenCalled()
})
it('refuses a commit if a turn starts while the message is being generated', async () => {
  const { runtime, git, generate, push, commit } = await setup()
  generate.mockReturnValue(
    Effect.sync(() => {
      runtime.services.store.updateTask('task', (task) => ({ ...task, status: 'running' }))
      return { message: 'Update fixture' }
    }),
  )
  expect((await commit()).status).toBe(409)
  expect(git('log', '-1', '--format=%s')).toBe('Initial')
  expect(push).not.toHaveBeenCalled()
})
