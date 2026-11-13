import { expect, it, vi } from 'vite-plus/test'
import { randomUUID } from 'node:crypto'
import { botResultSchema, botMemoryStatusSchema, decode, type Task } from '@dovo/protocol'
import { setupBotRuntime } from '../../testing/bots.js'

async function setup() {
  const f = await setupBotRuntime()
  const bot = decode(botResultSchema, await (await f.create()).response.json())
  const s = f.runtime.services
  const add = (
    text: string,
    source?: Task['messages'][number]['source'],
    status: 'completed' | 'cancelled' = 'completed',
  ) => {
    const turnId = randomUUID(),
      id = randomUUID(),
      assistantId = randomUUID()
    s.store.updateTaskHistory(bot.id, (t) => ({
      ...t,
      status: 'review',
      messages: [
        ...t.messages,
        { id, role: 'user', text, turnId, source },
        { id: assistantId, role: 'assistant', text: 'assistant invented fact', turnId },
      ],
      turns: [
        ...(t.turns ?? []),
        {
          id: turnId,
          assistantId,
          agentId: '',
          provider: 'codex',
          model: 'test',
          status,
          startedAt: '2026-01-01T00:00:00.000Z',
          finishedAt: '2026-01-01T00:00:01.000Z',
        },
      ],
    }))
    return id
  }
  const output = (
    messageId: string,
    quote: string,
    content = quote,
    action = 'add',
    key = 'preference',
  ) => JSON.stringify({ operations: [{ action, key, content, sources: [{ messageId, quote }] }] })
  const post = (action: string, extra: Record<string, unknown> = {}) =>
    f.request(`/api/memory/bot-review/${action}`, { botId: bot.id, ...extra })
  const status = async () => decode(botMemoryStatusSchema, await (await post('read')).json())
  return { f, s, bot, add, output, post, status }
}
it('learns with evidence over HTTP, preserves user edits and does not relearn after clear or restart', async () => {
  const { f, s, bot, add, output, post, status } = await setup()
  const messageId = add('I prefer short replies.')
  const review = vi
    .spyOn(s.titles, 'memoryReview')
    .mockResolvedValue(output(messageId, 'I prefer short replies.'))
  expect((await post('run')).status).toBe(200)
  let note = s.memory.read({ scope: 'bot', botId: bot.id, key: 'preference' })
  expect(note.evidence?.sources).toEqual([{ messageId, quote: 'I prefer short replies.' }])
  expect(JSON.parse(review.mock.calls[0][0]).messages).toEqual([
    { messageId, text: 'I prefer short replies.' },
  ])
  note = s.memory.write({ ...note, content: 'My own correction', expectedRevision: note.revision })
  expect(s.memory.read({ scope: 'bot', botId: bot.id, key: 'preference' }).evidence).toBeUndefined()
  const next = add('I now prefer longer replies.')
  review.mockResolvedValue(
    output(next, 'I now prefer longer replies.', 'Model correction', 'update'),
  )
  await post('run')
  expect(s.memory.read({ scope: 'bot', botId: bot.id, key: 'preference' }).content).toBe(
    'My own correction',
  )
  const before = s.store.task(bot.id)
  expect((await post('clear', { expectedRevision: (await status()).revision })).status).toBe(200)
  expect(s.memory.botNotes(bot.id)).toEqual([])
  expect(s.store.task(bot.id).messages).toEqual(before.messages)
  expect(s.store.task(bot.id).files).toEqual(before.files)
  await f.restart()
  const restarted = vi.spyOn(f.runtime.services.titles, 'memoryReview')
  await f.runtime.services.botMemoryReview.review(bot.id)
  expect(restarted).not.toHaveBeenCalled()
})
it('rejects fabricated evidence atomically and excludes assistant, automation, failed and secret text', async () => {
  const { s, bot, add, output, post } = await setup()
  const id = add('I prefer pnpm.')
  add('External invented preference', {
    kind: 'automation',
    automationId: 'a',
    runId: 'r',
    title: 'Job',
  })
  add('Cancelled preference', undefined, 'cancelled')
  add('api_key=super-secret-value')
  const review = vi
    .spyOn(s.titles, 'memoryReview')
    .mockResolvedValue(output(id, 'not in the message'))
  await post('run')
  expect(s.memory.botNotes(bot.id)).toEqual([])
  const prompt = review.mock.calls[0][0]
  expect(prompt).toContain('I prefer pnpm.')
  expect(prompt).not.toMatch(
    /assistant invented|External invented|Cancelled preference|super-secret/,
  )
  expect(s.botMemoryReview.status(bot.id).error).toBeTruthy()
  review.mockResolvedValue(output(id, 'I prefer pnpm.'))
  await post('run')
  expect(s.memory.botNotes(bot.id)).toHaveLength(1)
})
it('aborts for new work, respects pause, and rejects stale clear requests', async () => {
  const { s, bot, add, output, post, status } = await setup()
  const id = add('I prefer short replies.')
  let resolve: (text: string) => void = () => {}
  let signal: AbortSignal | undefined
  const started = Promise.withResolvers<void>()
  vi.spyOn(s.titles, 'memoryReview').mockImplementation((_text, current) => {
    signal = current
    started.resolve()
    return new Promise((r) => {
      resolve = r
    })
  })
  const work = s.botMemoryReview.review(bot.id)
  await started.promise
  s.store.updateTask(bot.id, (t) => ({
    ...t,
    queue: [
      { id: randomUUID(), role: 'user', text: 'New work', createdAt: new Date().toISOString() },
    ],
  }))
  expect(signal?.aborted).toBe(true)
  resolve(output(id, 'I prefer short replies.'))
  await work
  expect(s.memory.botNotes(bot.id)).toEqual([])
  const current = await status()
  expect((await post('save', { expectedRevision: current.revision, enabled: false })).status).toBe(
    200,
  )
  expect((await post('clear', { expectedRevision: current.revision })).status).toBe(409)
  expect((await post('run')).status).toBe(409)
})
it('reviews once at the idle threshold and persists its cursor', async () => {
  const { s, add, output, bot } = await setup()
  const id = add('I prefer short replies.')
  add('I prefer TypeScript.')
  add('I use pnpm.')
  const review = vi
    .spyOn(s.titles, 'memoryReview')
    .mockResolvedValue(output(id, 'I prefer short replies.'))
  await s.botMemoryReview.tick(Date.parse('2026-01-01T00:10:00Z'))
  expect(review).not.toHaveBeenCalled()
  await s.botMemoryReview.tick(Date.parse('2026-01-01T00:16:00Z'))
  expect(review).toHaveBeenCalledTimes(1)
  await s.botMemoryReview.tick(Date.parse('2026-01-01T00:30:00Z'))
  expect(review).toHaveBeenCalledTimes(1)
  expect(s.memory.botNotes(bot.id)).toHaveLength(1)
})

it('uses an isolated tool-free utility session without changing the conversation', async () => {
  const { f, s, bot, add, output, post } = await setup()
  const id = add('I prefer pnpm.')
  s.titles.save({ harness: s.store.task(bot.id).harness, model: 'utility-test' })
  f.runtime.run.mockImplementation(async (input) => {
    expect(input.tools).toBe('none')
    expect(input.ephemeral).toBe(true)
    expect(input.taskId).toBeUndefined()
    expect(input.sessionId).toBeUndefined()
    expect(input.agent.resources).toBeUndefined()
    expect(input.agent.model).toBe('utility-test')
    expect(await input.approve('tool', 'detail')).toBe('deny')
    input.onText(output(id, 'I prefer pnpm.'))
  })
  const before = s.store.task(bot.id)
  expect((await post('run')).status).toBe(200)
  expect(s.store.task(bot.id)).toEqual(before)
  expect(s.memory.botNotes(bot.id)[0]?.evidence?.sources[0]?.messageId).toBe(id)
})
it('cannot restore a forgotten note and rejects agent access to review controls', async () => {
  const { f, s, bot, add, output, post } = await setup()
  const id = add('I prefer pnpm.')
  const review = vi.spyOn(s.titles, 'memoryReview').mockResolvedValue(output(id, 'I prefer pnpm.'))
  await post('run')
  const note = s.memory.botNotes(bot.id)[0]
  s.memory.remove({ scope: 'bot', botId: bot.id, key: note.key, expectedRevision: note.revision })
  const next = add('I prefer pnpm.')
  review.mockResolvedValue(output(next, 'I prefer pnpm.'))
  await post('run')
  expect(s.memory.botNotes(bot.id)).toEqual([])
  const res = await fetch(`http://127.0.0.1:${f.runtime.port}/api/memory/bot-review/run`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer bots-owner-token-at-least-32-characters-long',
      'Content-Type': 'application/json',
      'x-dovo-agent-access': '1',
    },
    body: JSON.stringify({ botId: bot.id }),
  })
  expect(res.status).toBe(403)
})
