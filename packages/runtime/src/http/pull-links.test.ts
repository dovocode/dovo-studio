import { expect, it } from 'vite-plus/test'
import { startRuntime } from '../index'
import { decode, taskSchema } from '@dovo/protocol'

it('links selected PRs from any project atomically and idempotently, without fetching the destination forge', async () => {
  const token = 'pull-link-test-owner-token-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  try {
    const task = decode(taskSchema, {
      id: 'thread',
      title: 'Thread',
      repositoryId: '',
      agentId: '',
      status: 'draft',
      createdAt: '',
      messages: [],
      files: [],
      draft: 'Keep my message',
      example: false,
    })
    runtime.services.store.update((workspace) => ({ ...workspace, tasks: [task] }))
    const pull = (number: number) => ({
      number,
      title: 'Foreign PR',
      url: `https://github.com/foreign/project/pull/${number}`,
      repositoryUrl: 'https://github.com/foreign/project',
      provider: 'github',
    })
    const call = (pulls: unknown[], credential = token) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/scm/pulls/link-thread`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id, pulls }),
      })
    expect((await call([pull(1)], 'invalid')).status).toBe(401)
    expect((await call([pull(1), pull(2)])).status).toBe(200)
    expect((await call([pull(1)])).status).toBe(200)
    expect(runtime.services.store.task(task.id)).toMatchObject({
      draft: 'Keep my message',
      repositoryId: '',
      status: 'draft',
      linkedPullRequests: [pull(1), pull(2)],
    })
    expect((await call([{ ...pull(3), number: 4 }])).status).toBe(400)
    expect((await call([{ ...pull(3), url: 'https://github.com/o/r/issues/3' }])).status).toBe(400)
    expect((await call(Array.from({ length: 20 }, (_, index) => pull(index + 3)))).status).toBe(400)
    expect(runtime.services.store.task(task.id).linkedPullRequests).toHaveLength(2)
    runtime.services.store.update((workspace) => ({
      ...workspace,
      tasks: workspace.tasks.map((item) => ({ ...item, archivedAt: new Date().toISOString() })),
    }))
    expect((await call([pull(3)])).status).toBe(409)
  } finally {
    await runtime.close()
  }
})
