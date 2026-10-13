import { randomBytes } from 'node:crypto'
import { expect, it, vi } from 'vite-plus/test'
import { startRuntime } from '../../index'
import { fixture } from '../../testing/fixture'
import { runtimeIntegration } from '../../testing/integration'

vi.setConfig(runtimeIntegration)

it('rejects direct and longer dependency cycles without changing the target', async () => {
  const f = await fixture()
  const token = randomBytes(32).toString('base64url')
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  try {
    const s = runtime.services
    s.store.update(() => f.workspace)
    const tasks = ['First', 'Second', 'Third'].map((title) =>
      s.tasks.create({ title, repositoryId: 'repo', agentId: 'agent', objective: 'Request' }),
    )
    const [first, second, third] = tasks
    if (!first || !second || !third) throw new Error('Missing fixture tasks')
    const chain = (id: string, sourceId: string | null) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/tasks/start-after`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, sourceId }),
      })
    expect((await chain(first.id, first.id)).status).toBe(400)
    expect((await chain(second.id, first.id)).status).toBe(200)
    expect((await chain(first.id, second.id)).status).toBe(400)
    expect(s.store.task(first.id).startAfter).toBeUndefined()
    expect((await chain(third.id, second.id)).status).toBe(200)
    expect((await chain(first.id, third.id)).status).toBe(400)
    expect(s.store.task(first.id).startAfter).toBeUndefined()
    expect(s.store.task(second.id).startAfter?.taskId).toBe(first.id)
    expect(s.store.task(third.id).startAfter?.taskId).toBe(second.id)
    expect((await chain(second.id, null)).status).toBe(200)
    expect(s.store.task(second.id).startAfter).toBeUndefined()
  } finally {
    await runtime.close()
    await f.cleanup()
  }
})
