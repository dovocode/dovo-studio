import { afterEach, expect, it } from 'vitest'
import { startRuntime } from '../index'
import { fixture } from '../testing/fixture'
import { decode, taskSchema } from '@dovo/protocol'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
it('receives drafts idempotently, verifies Git identity, and never starts a checkout before input', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const token = 'machine-test-owner-token-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(() => runtime.close())
  const s = runtime.services
  s.store.update(() => f.workspace)
  await s.git.command(f.directory, [
    'remote',
    'add',
    'origin',
    'https://token:secret@github.com/test/project.git',
  ])
  const post = (path: string, body: unknown) =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  const task = decode(taskSchema, {
    id: 'moving',
    title: 'Draft',
    repositoryId: 'repo',
    agentId: '',
    status: 'draft',
    createdAt: new Date().toISOString(),
    messages: [],
    files: [],
    draft: 'Keep this text',
    execution: 'worktree',
    example: false,
  })
  const before = await s.git.command(f.directory, ['worktree', 'list', '--porcelain'])
  const received = await post('/api/tasks/draft-receive', {
    task,
    gitIdentity: 'github.com/test/project',
  })
  expect(received.status).toBe(200)
  expect(
    (await post('/api/tasks/draft-receive', { task, gitIdentity: 'github.com/test/project' }))
      .status,
  ).toBe(200)
  expect(s.store.task(task.id).messages).toHaveLength(0)
  await expect(s.tasks.start(task.id)).rejects.toThrow('first prompt')
  await expect(s.checkouts.directory(task.id)).rejects.toThrow('first prompt')
  expect(await s.git.command(f.directory, ['worktree', 'list', '--porcelain'])).toBe(before)
  expect(
    (await post('/api/tasks/draft-receive', { task, gitIdentity: 'github.com/wrong/repo' })).status,
  ).toBe(409)
  const snapshot = await fetch(`http://127.0.0.1:${runtime.port}/api/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await snapshot.text()
  expect(data).toContain('github.com/test/project')
  expect(data).not.toContain('token:secret')
  expect(
    (
      await post('/api/tasks/draft-moved', {
        id: task.id,
        repositoryId: 'repo',
        draft: 'stale text',
        gitIdentity: 'github.com/test/project',
      })
    ).status,
  ).toBe(409)
  expect(s.store.task(task.id).archivedAt).toBeUndefined()
  expect(
    (
      await post('/api/tasks/draft-moved', {
        id: task.id,
        repositoryId: 'repo',
        gitIdentity: 'github.com/test/project',
        draft: task.draft,
      })
    ).status,
  ).toBe(200)
  expect(s.store.task(task.id).archivedAt).toBeTruthy()
  expect(
    (await post('/api/tasks/draft-receive', { task, gitIdentity: 'github.com/test/project' }))
      .status,
  ).toBe(200)
  expect(s.store.task(task.id).archivedAt).toBeUndefined()
  s.store.updateTask(task.id, (current) => ({
    ...current,
    messages: [{ id: 'sent', role: 'user', text: 'Start' }],
  }))
  expect(
    (
      await post('/api/tasks/draft-moved', {
        id: task.id,
        repositoryId: 'repo',
        gitIdentity: 'github.com/test/project',
        draft: task.draft,
      })
    ).status,
  ).toBe(409)
  expect(
    (await post('/api/tasks/draft-receive', { task, gitIdentity: 'github.com/test/project' }))
      .status,
  ).toBe(409)
})
