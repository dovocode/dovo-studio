import { expect, it } from 'vite-plus/test'
import { decode, snapshotSchema, type Task } from '@dovo/protocol'
import { startRuntime } from '../../index'

it('clears the confirmed checklist across snapshots, preserves thread data, and protects newer progress and retries', async () => {
  const owner = 'checklist-route-owner-token-at-least-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: owner, port: 0 })
  try {
    const { store, tasks } = runtime.services
    const task = tasks.create({
      title: 'Checklist',
      repositoryId: '',
      agentId: '',
      objective: 'Original message',
    })
    const other = tasks.create({ title: 'Other', repositoryId: '', agentId: '', objective: '' })
    const items = [
      { id: 'one', text: 'Done', status: 'completed' },
      { id: 'two', text: 'Still needed', status: 'pending' },
    ] satisfies NonNullable<Task['nativeTodos']>
    store.updateTask(task.id, (current) => ({
      ...current,
      nativeTodos: items,
      draft: 'Keep draft',
      queuePaused: true,
    }))
    store.updateTask(other.id, (current) => ({ ...current, nativeTodos: items }))
    tasks.queue.add(task.id, 'queued', 'Keep follow-up')
    const before = store.task(task.id)
    const clear = (input: unknown, mutationId?: string, credential = owner) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/tasks/checklist/clear`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credential}`,
          'Content-Type': 'application/json',
          ...(mutationId ? { 'x-dovo-mutation-id': mutationId } : {}),
        },
        body: JSON.stringify(input),
      })
    const input = { id: task.id, expectedItems: items }
    expect((await clear(input, undefined, 'invalid-credential')).status).toBe(401)
    expect((await clear({ id: task.id })).status).toBe(400)
    expect(
      (await clear({ ...input, expectedItems: [{ text: 'Wrong', status: 'done' }] })).status,
    ).toBe(400)
    expect((await clear({ ...input, expectedItems: [] })).status).toBe(409)
    expect(store.taskSummary(task.id).nativeTodos).toEqual(items)
    expect((await clear(input, 'clear-checklist-receipt')).status).toBe(200)
    expect(store.taskSummary(task.id).nativeTodos).toBeUndefined()
    const snapshot = decode(
      snapshotSchema,
      await (
        await fetch(`http://127.0.0.1:${runtime.port}/api/snapshot`, {
          headers: { Authorization: `Bearer ${owner}` },
        })
      ).json(),
    )
    expect(
      snapshot.workspace.tasks.find((entry) => entry.id === task.id)?.nativeTodos,
    ).toBeUndefined()
    expect(store.taskSummary(other.id).nativeTodos).toEqual(items)
    expect(store.task(task.id)).toMatchObject({
      messages: before.messages,
      queue: before.queue,
      draft: before.draft,
      status: before.status,
      queuePaused: before.queuePaused,
    })
    // A lost-response retry must not clear even an identical new checklist.
    store.updateTask(task.id, (current) => ({ ...current, nativeTodos: items }))
    expect((await clear(input, 'clear-checklist-receipt')).status).toBe(200)
    expect(store.taskSummary(task.id).nativeTodos).toEqual(items)
    const newer = [...items, { text: 'New progress', status: 'in-progress' as const }]
    store.updateTask(task.id, (current) => ({ ...current, nativeTodos: newer }))
    const rejected = await clear(input, 'stale-checklist-receipt')
    expect(rejected.status).toBe(409)
    expect(await rejected.json()).toMatchObject({ mutationRejected: true })
    const recovered = await clear(input, 'stale-checklist-receipt')
    expect(recovered.status).toBe(409)
    expect(await recovered.json()).toMatchObject({ mutationRejected: true })
    expect(store.taskSummary(task.id).nativeTodos).toEqual(newer)
    expect((await clear({ id: 'missing', expectedItems: [] })).status).toBe(404)
    expect((await clear({ id: task.id, expectedItems: newer })).status).toBe(200)
    expect((await clear(input)).status).toBe(200)
  } finally {
    await runtime.close()
  }
})
