import { expect, it } from 'vite-plus/test'
import { randomUUID } from 'node:crypto'
import { botContextMessages, botInstructions } from './bots.js'
import { compareBotActivity } from './bot-activity.js'
import { botSchema, decode, taskSchema } from '../index.js'

const bot = decode(botSchema, {
  role: 'Release manager',
  responsibilities: 'Watch releases.',
  state: 'active',
  revision: randomUUID(),
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
})

it('excludes only reset ranges and retains messages after each reset', () => {
  const messages = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id }))
  const reset = (afterMessageId: string, throughMessageId: string) => ({
    requestRevision: randomUUID(),
    turnId: 'turn',
    afterMessageId,
    throughMessageId,
    at: '',
  })
  expect(botContextMessages(messages, { contextResets: [reset('b', 'd')] })).toEqual([
    messages[0],
    messages[1],
    messages[4],
    messages[5],
  ])
  expect(
    botContextMessages(messages, { contextResets: [reset('b', 'd'), reset('a', 'e')] }),
  ).toEqual([messages[0], messages[5]])
  expect(botContextMessages(messages, { contextResets: [reset('missing', 'd')] })).toEqual(messages)
  expect(messages).toHaveLength(6)
})

it('orders pinned Bots first and uses conversation activity rather than settings or read state', () => {
  const task = (id: string, date: string) =>
    decode(taskSchema, {
      id,
      title: id,
      repositoryId: '',
      agentId: '',
      status: 'review',
      createdAt: date,
      draft: '',
      messages: [],
      files: [],
      example: false,
      bot,
    })
  const older = task('older', '2026-11-01T00:00:00Z')
  const newer = task('newer', '2026-11-02T00:00:00Z')
  expect([older, newer].sort(compareBotActivity).map((t) => t.id)).toEqual(['newer', 'older'])
  older.pinned = true
  expect([newer, older].sort(compareBotActivity).map((t) => t.id)).toEqual(['older', 'newer'])
})

it('steers supported Bots toward background delegation while respecting user limits', () => {
  expect(botInstructions(bot, true)).toContain('subagent_spawn')
  expect(botInstructions(bot, true)).toContain(
    'unless the user or repository instructions restrict delegation',
  )
  expect(botInstructions(bot, true)).toContain('finish your reply')
  expect(botInstructions(bot, true)).toContain('Expected output, and Verification')
  expect(botInstructions(bot, true)).toContain('advance only after checking')
  expect(botInstructions(bot, true)).toContain('data.botId')
  expect(botInstructions(bot, true)).toContain('neither you nor a worker can approve it')
  expect(botInstructions(bot)).not.toContain('subagent_spawn')
  expect(botInstructions(bot)).toContain('delegation tools are unavailable')
})
