import { expect, it } from 'vitest'
import { estimatedTurnCost } from './estimated-cost.js'

it('prices local tokens at standard API rates and leaves unknown models unpriced', () => {
  const usage = { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 }
  expect(estimatedTurnCost('codex', 'gpt-6-sol', usage)).toBe(14.7)
  expect(estimatedTurnCost('claude', 'claude-sonnet-4-6-20260217', usage)).toBe(22.05)
  expect(estimatedTurnCost('claude', 'default', usage)).toBeUndefined()
  expect(estimatedTurnCost('opencode', 'gpt-6-sol', usage)).toBeUndefined()
})
