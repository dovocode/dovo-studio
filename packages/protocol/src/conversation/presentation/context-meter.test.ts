import { expect, it } from 'vitest'
import { contextMeter } from './context-meter.js'

it('describes context usage with and without a known window size', () => {
  const at = '2026-09-27T10:00:00.000Z'
  expect(contextMeter({})).toBeUndefined()
  expect(contextMeter({ contextUsage: { used: 41_000, updatedAt: at } })).toMatchObject({
    level: 'ok',
    short: '41k',
  })
  expect(
    contextMeter({ contextUsage: { used: 170_000, limit: 200_000, updatedAt: at } }),
  ).toMatchObject({
    percent: 85,
    level: 'warn',
    short: '85%',
    label: expect.stringContaining('Compact'),
  })
  expect(
    contextMeter({ contextUsage: { used: 250_000, limit: 200_000, updatedAt: at } }),
  ).toMatchObject({ percent: 100, level: 'full' })
})
