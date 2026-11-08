import { expect, it } from 'vite-plus/test'
import type { Task } from '@dovo/studio-core'
import { compactionsByMessage } from './compactions-by-message'

it('groups explicit and legacy compactions in order using the first matching turn', () => {
  const event = (turnId: string, messageId?: string) => ({
    at: '',
    turnId,
    messageId,
    sessionId: '',
    provider: 'codex' as const,
    trigger: 'auto' as const,
  })
  const turn = (assistantId: string): NonNullable<Task['turns']>[number] => ({
    id: 'turn',
    assistantId,
    status: 'completed',
    agentId: '',
    provider: 'codex',
    model: '',
    startedAt: '',
  })
  const explicit = event('missing', 'first')
  const legacy = event('turn')
  const missing = event('missing')
  const empty = event('turn', '')
  expect([
    ...compactionsByMessage({
      compactions: [explicit, legacy, missing, empty],
      turns: [turn('first'), turn('second')],
    }),
  ]).toEqual([['first', [explicit, legacy]]])
  expect(compactionsByMessage({}).size).toBe(0)
})
