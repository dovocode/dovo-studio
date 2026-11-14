import { expect, it } from 'vite-plus/test'
import { randomUUID } from 'node:crypto'
import { defaultTaskHarness, botResultSchema, decode } from '@dovo/protocol'
import { setupBotRuntime } from '../../testing/bots.js'
import { waitForRuntime } from '../../testing/integration.js'

it('keeps active work on its model and hands queued input to the saved next-turn choice', async () => {
  const f = await setupBotRuntime()
  const created = decode(botResultSchema, await (await f.create()).response.json())
  const s = f.runtime.services
  let release!: () => void
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  f.runtime.run.mockImplementation(async (input) => {
    input.onSession(input.agent.provider + '-session')
    if (input.agent.provider === 'codex') await waiting
    input.onText('Completed by ' + input.agent.provider)
  })
  await s.tasks.send(created.id, 'first', 'Original request')
  await waitForRuntime(() => expect(f.inputs).toHaveLength(1))
  const input = {
    id: created.id,
    requestId: randomUUID(),
    expectedBotRevision: created.bot.revision,
    harness: { ...defaultTaskHarness('claude'), model: 'next-model' },
  }
  expect((await f.request('/api/tasks/pending-harness', input)).status).toBe(200)
  expect((await f.request('/api/tasks/pending-harness', input)).status).toBe(200)
  expect(f.inputs[0].agent.provider).toBe('codex')
  await s.tasks.send(created.id, 'second', 'Keep queued input')
  release()
  await waitForRuntime(() => {
    expect(s.store.task(created.id).status).toBe('review')
    expect(f.inputs).toHaveLength(2)
  })
  expect(f.inputs[1].agent).toMatchObject({ provider: 'claude', model: 'next-model' })
  expect(f.inputs[1].sessionId).toBeUndefined()
  expect(f.inputs[1].prompt).toContain('Original request')
  expect(f.inputs[1].prompt).toContain('Keep queued input')
  expect(s.store.task(created.id).pendingHarness).toBeUndefined()
  expect(
    s.store.task(created.id).messages.filter((message) => message.id === 'second'),
  ).toHaveLength(1)
})

it('preserves a pending selection across restart and rejects stale updates and cancellations', async () => {
  const f = await setupBotRuntime()
  const created = decode(botResultSchema, await (await f.create()).response.json())
  await f.runtime.services.tasks.send(created.id, 'first', 'Establish saved history')
  await waitForRuntime(() =>
    expect(f.runtime.services.store.task(created.id).status).toBe('review'),
  )
  const input = {
    id: created.id,
    requestId: randomUUID(),
    expectedBotRevision: created.bot.revision,
    harness: defaultTaskHarness('claude'),
  }
  expect((await f.request('/api/tasks/pending-harness', input)).status).toBe(200)
  expect(
    (
      await f.request('/api/tasks/pending-harness', {
        ...input,
        requestId: randomUUID(),
        harness: null,
      })
    ).status,
  ).toBe(409)
  await f.restart()
  expect(f.runtime.services.store.task(created.id).pendingHarness?.id).toBe(input.requestId)
  await f.runtime.services.tasks.send(created.id, 'next', 'Continue after restart')
  await waitForRuntime(() =>
    expect(f.runtime.services.store.task(created.id).status).toBe('review'),
  )
  expect(f.inputs.at(-1)?.agent.provider).toBe('claude')
})

it('keeps queued input and requires review when settings changed after the selection', async () => {
  const f = await setupBotRuntime()
  const created = decode(botResultSchema, await (await f.create()).response.json())
  const s = f.runtime.services
  await s.tasks.send(created.id, 'first', 'Establish saved history')
  await waitForRuntime(() => expect(s.store.task(created.id).status).toBe('review'))
  const input = {
    id: created.id,
    requestId: randomUUID(),
    expectedBotRevision: created.bot.revision,
    harness: defaultTaskHarness('claude'),
  }
  expect((await f.request('/api/tasks/pending-harness', input)).status).toBe(200)
  expect(
    (
      await f.request('/api/bots/update', {
        id: created.id,
        expectedRevision: created.bot.revision,
        role: 'New role',
      })
    ).status,
  ).toBe(200)
  await s.tasks.send(created.id, 'new', 'Preserve this new request')
  expect(s.store.task(created.id).error).toContain('stale')
  expect(s.store.task(created.id).pendingHarness?.id).toBe(input.requestId)
  expect(s.store.task(created.id).queue?.some((message) => message.id === 'new')).toBe(true)
  expect(f.inputs).toHaveLength(1)
})
