import { afterEach, expect, it } from 'vite-plus/test'
import { join } from 'node:path'
import { startRuntime } from './index'
import { createServices } from './services'
import { openDatabase } from './storage/database'
import { fixture } from './testing/fixture'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
it('restarts over the same database without replaying conversations into activity', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const options = {
    databasePath: join(f.directory, '.git', 'startup.sqlite'),
    ownerToken: 'startup-test-owner-token-with-32-characters',
    port: 0,
  }
  let r = await startRuntime(options)
  cleanups.push(() => r.close())
  r.services.store.update(() => f.workspace)
  const task = r.services.tasks.create({
    title: 'Seeded',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Original request',
  })
  r.services.store.updateTask(task.id, (t) => ({
    ...t,
    messages: [...t.messages, { id: 'reply', role: 'assistant', text: 'Answer' }],
  }))
  const count = (kind: string) => {
    const row = r.services.db
      .prepare('SELECT COUNT(*) AS total FROM activity WHERE kind=? AND scope=?')
      .get(kind, task.id)
    if (!row || typeof row !== 'object' || !('total' in row) || typeof row.total !== 'number')
      throw new Error('Invalid activity count')
    return row.total
  }
  const before = { task: count('task'), message: count('message') }
  expect(before.task).toBeGreaterThan(0)
  expect(before.message).toBe(2)
  await r.close()
  r = await startRuntime(options)
  expect({ task: count('task'), message: count('message') }).toEqual(before)
  expect(r.services.activity.pruneBefore(new Date(Date.now() + 60_000).toISOString())).toBe(
    before.task + before.message,
  )
  await r.close()
  r = await startRuntime(options)
  expect({ task: count('task'), message: count('message') }).toEqual({ task: 0, message: 0 })
  expect(r.services.store.task(task.id).messages.map((m) => m.id)).toContain('reply')
})

it.each([false, true])(
  'audits only the interrupted assistant stream on crash recovery (boundary=%s)',
  async (boundary) => {
    const f = await fixture()
    cleanups.push(f.cleanup)
    const options = {
      databasePath: join(f.directory, '.git', 'stream-crash.sqlite'),
      ownerToken: 'startup-test-owner-token-with-32-characters',
      port: 0,
    }
    function reopen() {
      const db = openDatabase(options.databasePath)
      const services = createServices(db, options.ownerToken)
      cleanups.push(async () => {
        await services.tasks.dispose()
        if (db.open) db.close()
      })
      return services
    }
    let services = reopen()
    services.store.update(() => f.workspace)
    const task = services.tasks.create({
      title: 'Interrupted stream',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: 'Original request',
    })
    services.store.updateTask(task.id, (current) => ({
      ...current,
      messages: [...current.messages, { id: 'old', role: 'assistant', text: 'Pruned old answer' }],
    }))
    services.activity.pruneBefore(new Date(Date.now() + 60_000).toISOString())
    services.store.updateTask(task.id, (current) => ({
      ...current,
      status: 'running',
      runPhase: 'provider',
      activeRunId: 'interrupted-attempt',
      turns: [
        {
          id: 'turn',
          assistantId: 'inflight',
          status: 'running',
          agentId: 'agent',
          provider: 'codex',
          model: '',
          startedAt: new Date().toISOString(),
        },
      ],
    }))
    services.store.updateTask(task.id, (current) => ({
      ...current,
      messages: [...current.messages, { id: 'inflight', role: 'assistant', text: '' }],
    }))
    if (boundary)
      services.store.updateTask(task.id, (current) => ({
        ...current,
        messages: current.messages.map((message) =>
          message.id === 'inflight'
            ? { ...message, text: 'First segment.', textBreaks: [14] }
            : message,
        ),
      }))
    services.store.updateTask(task.id, (current) => ({
      ...current,
      messages: current.messages.map((message) =>
        message.id === 'inflight'
          ? { ...message, text: 'First segment. Unsaved audit tail.' }
          : message,
      ),
    }))
    expect(services.activity.list('', 'message', 0).events).toHaveLength(boundary ? 1 : 0)
    // No executor owns this seeded run, so reopening preserves the crash-time workspace
    // without completing the turn or flushing Activity's in-memory stream buffer.
    await services.tasks.dispose()
    services.db.close()
    services = reopen()
    const rows = services.activity.list('', 'message', 0).events
    expect(services.store.task(task.id).status).toBe('failed')
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(`message:${task.id}:inflight`)
    expect(JSON.parse(rows[0].payload)).toMatchObject({
      text: 'First segment. Unsaved audit tail.',
    })
    services.activity.pruneBefore(new Date(Date.now() + 60_000).toISOString())
    await services.tasks.dispose()
    services.db.close()
    services = reopen()
    expect(services.activity.list('', 'message', 0).events).toEqual([])
  },
)
