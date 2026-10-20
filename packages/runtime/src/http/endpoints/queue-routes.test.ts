import { expect, it } from 'vite-plus/test'
import { startRuntime } from '../../index'

it('validates and applies a drag move in one queue request', async () => {
  const ownerToken = 'queue-route-owner-token-at-least-thirty-two-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken, port: 0 })
  try {
    const { store, tasks } = runtime.services
    const task = tasks.create({ title: 'Sort queue', repositoryId: '', agentId: '', objective: '' })
    store.updateTask(task.id, (current) => ({ ...current, queuePaused: true }))
    tasks.queue.add(task.id, 'first', 'First')
    tasks.queue.add(task.id, 'second', 'Second')
    tasks.queue.add(task.id, 'third', 'Third')
    const move = (input: Record<string, unknown>) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/tasks/queue`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id, action: 'move', ...input }),
      })
    expect((await move({ messageId: 'third', beforeMessageId: 'first' })).status).toBe(200)
    expect(store.taskSummary(task.id).queue?.map((message) => message.id)).toEqual([
      'third',
      'first',
      'second',
    ])
    expect((await move({ messageId: 'first', beforeMessageId: null })).status).toBe(200)
    expect((await move({ messageId: 'first' })).status).toBe(400)
    expect((await move({ beforeMessageId: null })).status).toBe(400)
    expect((await move({ messageId: 'first', beforeMessageId: 'missing' })).status).toBe(409)
    expect((await move({ messageId: 'missing', beforeMessageId: null })).status).toBe(409)
    expect(store.taskSummary(task.id).queue?.map((message) => message.id)).toEqual([
      'third',
      'second',
      'first',
    ])
    expect(store.taskSummary(task.id).queuePaused).toBe(true)
  } finally {
    await runtime.close()
  }
})

it('accepts and edits one-turn model choices, rejects invalid harnesses and prevents steering overrides', async () => {
  const ownerToken = 'queue-route-owner-token-at-least-thirty-two-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken, port: 0 })
  try {
    const { store, tasks } = runtime.services
    const task = tasks.create({
      title: 'Turn choices',
      repositoryId: '',
      agentId: '',
      objective: '',
    })
    store.updateTask(task.id, (t) => ({
      ...t,
      status: 'running',
      queuePaused: true,
      harness: { provider: 'codex', model: '', endpoint: '', instructions: '', permission: 'ask' },
    }))
    const request = (path: string, input: Record<string, unknown>) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/tasks/${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id, ...input }),
      })
    const settings = { provider: 'codex', model: 'model-large', reasoning: 'high' }
    expect(
      (await request('message', { messageId: 'one', text: 'One', turnSettings: settings })).status,
    ).toBe(200)
    expect(store.task(task.id).queue?.[0].turnSettings).toEqual(settings)
    expect(
      (
        await request('message', {
          messageId: 'one',
          text: 'One',
          turnSettings: { ...settings, reasoning: 'low' },
        })
      ).status,
    ).toBe(409)
    expect(
      (
        await request('message', {
          messageId: 'wrong',
          text: 'Wrong',
          turnSettings: { ...settings, provider: 'claude' },
        })
      ).status,
    ).toBe(409)
    expect(
      (
        await request('message', {
          messageId: 'invalid',
          text: 'Invalid',
          turnSettings: { ...settings, permission: 'yolo' },
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await request('steer', {
          messageId: 'steer',
          text: 'Steer',
          runId: 'run',
          turnSettings: settings,
        })
      ).status,
    ).toBe(409)
    expect(
      (await request('queue', { action: 'steer', messageId: 'one', runId: 'run' })).status,
    ).toBe(409)
    const edit = {
      action: 'edit',
      messageId: 'one',
      text: 'One',
      expectedText: 'One',
      turnSettings: { ...settings, reasoning: 'low' },
      expectedTurnSettings: settings,
    }
    expect((await request('queue', edit)).status).toBe(200)
    expect((await request('queue', edit)).status).toBe(409)
    expect(
      (
        await request('queue', {
          ...edit,
          turnSettings: null,
          expectedTurnSettings: { ...settings, reasoning: 'low' },
        })
      ).status,
    ).toBe(200)
    expect(store.task(task.id).queue?.[0].turnSettings).toBeUndefined()
  } finally {
    await runtime.close()
  }
})
