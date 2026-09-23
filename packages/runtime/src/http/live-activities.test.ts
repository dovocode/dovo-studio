import { decode } from '@dovo/protocol'
import { afterEach, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { taskSchema } from '@dovo/protocol'
import { startRuntime } from '../index'
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
})
it('authenticates Live Activity registrations and never logs push tokens', async () => {
  const ownerToken = randomBytes(32).toString('hex')
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken,
    port: 0,
  })
  cleanup.push(runtime.close)
  const task = decode(taskSchema, {
    id: 'task',
    title: 'Working',
    repositoryId: '',
    agentId: '',
    status: 'running',
    createdAt: new Date().toISOString(),
    messages: [],
    files: [],
    draft: '',
    example: false,
    turns: [
      {
        id: 'turn',
        assistantId: 'reply',
        agentId: '',
        provider: 'codex',
        model: '',
        status: 'running',
        startedAt: new Date().toISOString(),
      },
    ],
  })
  runtime.services.store.update((workspace) => ({
    ...workspace,
    tasks: [task],
  }))
  const pushToken = randomBytes(32).toString('hex')
  const register = (token: string) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/live-activities/register`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        activityId: 'activity',
        taskId: task.id,
        turnId: 'turn',
        pushToken,
      }),
    })
  expect((await register('invalid')).status).toBe(401)
  expect((await register(ownerToken)).status).toBe(200)
  expect(JSON.stringify(runtime.services.activity.list('', '', 0))).not.toContain(pushToken)
  expect(JSON.stringify(runtime.services.store.get())).not.toContain(pushToken)
})
