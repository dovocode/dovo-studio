import { expect, it, vi } from 'vitest'
import { UsagePricing } from './usage-pricing.js'
import { openDatabase } from './database.js'
import { usagePriceInput, type UsageRecord } from '@dovo/protocol'
const record: UsageRecord = {
  taskId: 't',
  title: 'Usage',
  turn: {
    id: 'turn',
    assistantId: 'reply',
    agentId: 'a',
    provider: 'codex',
    model: 'gpt-6.1-sol',
    startedAt: '2026-10-01T00:00:00Z',
    status: 'completed',
    tokens: 170,
    tokenUsage: { input: 100, output: 20, cacheRead: 50, cacheWrite: 0 },
  },
}
it('caches rates and reprices durable history while keeping provider-reported costs authoritative', async () => {
  const db = openDatabase(':memory:')
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        'gpt-6.1-sol': {
          input_cost_per_token: 0.000002,
          output_cost_per_token: 0.00001,
          cache_read_input_token_cost: 0.0000001,
        },
      }),
    ),
  )
  try {
    const pricing = new UsagePricing(db)
    await Promise.all([pricing.refresh(), pricing.refresh()])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(pricing.price(record).turn.estimatedCostUsd).toBeCloseTo(0.000405)
    pricing.setOverride('gpt-6.1-sol', { input: 3, output: 12, cacheRead: 1, cacheWrite: 3 })
    expect(pricing.price(record).turn.estimatedCostUsd).toBeCloseTo(0.00059)
    const reopened = new UsagePricing(db)
    expect(reopened.price(record).turn.estimatedCostUsd).toBeCloseTo(0.00059)
    const reported = {
      ...record,
      turn: { ...record.turn, costSource: 'provider' as const, estimatedCostUsd: 0.123 },
    }
    expect(reopened.price(reported)).toBe(reported)
    reopened.setOverride('gpt-6.1-sol', undefined)
    expect(reopened.price(record).turn.estimatedCostUsd).toBeCloseTo(0.000405)
  } finally {
    fetch.mockRestore()
    db.close()
  }
})
it('accepts explicit zero prices, decimal commas and blank cache fallback', () => {
  expect(usagePriceInput({ input: '0,5', output: '0', cacheRead: '', cacheWrite: '' })).toEqual({
    input: 0.5,
    output: 0,
    cacheRead: 0.5,
    cacheWrite: 0.5,
  })
  expect(
    usagePriceInput({ input: '-1', output: '0', cacheRead: '', cacheWrite: '' }),
  ).toBeUndefined()
})
