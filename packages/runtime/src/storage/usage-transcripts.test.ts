import { expect, it } from 'vitest'
import { transcriptUsage } from './usage-transcripts.js'
import { openCodeUsage } from './usage-opencode.js'
it('deduplicates cumulative Codex notifications and keeps cache input disjoint', () => {
  const event = {
    type: 'event_msg',
    timestamp: '2026-10-01T00:00:00Z',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: { total_tokens: 130 },
        last_token_usage: { input_tokens: 100, output_tokens: 30, cached_input_tokens: 70 },
      },
    },
  }
  const rows = transcriptUsage(
    'codex',
    [
      { type: 'session_meta', payload: { id: 'session' } },
      { type: 'turn_context', payload: { model: 'gpt-6.1-sol' } },
      event,
      event,
    ],
    'path',
  )
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    sessionId: 'session',
    turn: {
      tokens: 130,
      model: 'gpt-6.1-sol',
      tokenUsage: { input: 30, output: 30, cacheRead: 70 },
    },
  })
})
it('replaces repeated Claude message updates and counts cache creation separately', () => {
  const event = {
    type: 'assistant',
    sessionId: 'session',
    timestamp: '2026-10-01T00:00:00Z',
    message: {
      id: 'm',
      model: 'claude-sonnet-4-6',
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 70,
        cache_creation_input_tokens: 15,
      },
    },
  }
  const rows = transcriptUsage(
    'claude',
    [
      event,
      {
        ...event,
        message: { ...event.message, usage: { ...event.message.usage, output_tokens: 8 } },
      },
    ],
    'path',
  )
  expect(rows).toHaveLength(1)
  expect(rows[0]?.turn.tokens).toBe(103)
})
it('reads OpenCode token categories and does not mistake unknown zero cost for free billing', () => {
  const row = openCodeUsage({
    role: 'assistant',
    id: 'm',
    sessionID: 's',
    modelID: 'custom',
    providerID: 'provider',
    time: { created: Date.parse('2026-10-01T00:00:00Z') },
    tokens: { input: 10, output: 5, reasoning: 3, cache: { read: 20, write: 2 } },
    cost: 0,
  })
  expect(row?.turn).toMatchObject({
    model: 'provider/custom',
    tokens: 40,
    tokenUsage: { input: 10, output: 8, cacheRead: 20, cacheWrite: 2 },
  })
  expect(row?.turn.costSource).toBeUndefined()
})
