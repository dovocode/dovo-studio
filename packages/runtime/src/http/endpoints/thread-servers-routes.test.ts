import { expect, it } from 'vite-plus/test'
import { startRuntime } from '../../index.js'

it('requires pairing, validates server identity, and only lists an existing unarchived thread', async () => {
  const ownerToken = 'thread-servers-owner-token-at-least-thirty-two-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken, port: 0 })
  try {
    const task = runtime.services.tasks.create({
      title: 'Server',
      repositoryId: '',
      agentId: '',
      objective: '',
    })
    const request = (path: string, input: unknown, token = ownerToken) =>
      fetch(`http://127.0.0.1:${runtime.port}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    const path = '/api/terminals/servers'
    expect((await request(path, { taskId: task.id }, 'invalid')).status).toBe(401)
    expect((await request(path, { taskId: 'missing' })).status).toBe(404)
    expect((await request(path, { taskId: task.id })).status).toBe(200)
    expect(
      (await request(`${path}/stop`, { taskId: task.id, pid: -1, port: 3000, started: 'old' }))
        .status,
    ).toBe(400)
    expect(
      (
        await request(`${path}/stop`, {
          taskId: task.id,
          pid: process.pid,
          port: 3000,
          started: 'old',
        })
      ).status,
    ).toBe(409)
    runtime.services.store.updateTask(task.id, (current) => ({ ...current, archived: true }))
    expect((await request(path, { taskId: task.id })).status).toBe(409)
  } finally {
    await runtime.close()
  }
})
