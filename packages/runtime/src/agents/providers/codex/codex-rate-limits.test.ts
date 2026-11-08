import { expect, it } from 'vite-plus/test'
import { reportedPlanLimits } from '@dovo/protocol'
import { codexRateLimitUpdates } from './codex-rate-limits.js'

const primary = { usedPercent: 20, resetsAt: 2_000_000_000, windowDurationMins: 300 }
const secondary = { usedPercent: 40, resetsAt: 2_000_100_000, windowDurationMins: 10080 }

it('does not republish cached windows after newer account observations', () => {
  const update = codexRateLimitUpdates()
  const payload = { rateLimits: { primary, secondary } }
  expect(update('account/rateLimits/read', payload)).toBeDefined()
  // A separate account probe can now update the workspace. Neither a repeated
  // notification nor the next warm turn's cached read should overwrite it.
  expect(update('account/rateLimits/updated', payload)).toBeUndefined()
  expect(update('account/rateLimits/read', structuredClone(payload))).toBeUndefined()
  expect(update('account/read', { account: 'metadata' })).toEqual({ account: 'metadata' })
})

it('publishes only changed windows and accepts reset-driven decreases', () => {
  const update = codexRateLimitUpdates()
  update('account/rateLimits/read', { rateLimits: { primary, secondary } })
  const name = 'account/rateLimits/updated'
  const changed = update(name, {
    rateLimits: { primary: { ...primary, usedPercent: 21 }, secondary },
  })
  expect(reportedPlanLimits('codex', name, changed)).toMatchObject([
    { windowId: 'primary', usedPercent: 21 },
  ])
  expect(reportedPlanLimits('codex', name, changed)).toHaveLength(1)
  expect(update(name, { rateLimits: { primary: { usedPercent: 21 } } })).toBeUndefined()
  expect(
    reportedPlanLimits(
      'codex',
      name,
      update(name, {
        rateLimits: {
          primary: { ...primary, usedPercent: 0, resetsAt: primary.resetsAt + 3600 },
          secondary,
        },
      }),
    ),
  ).toMatchObject([{ windowId: 'primary', usedPercent: 0, resetsAt: primary.resetsAt + 3600 }])
})

it('tracks windows separately across named buckets and sparse events', () => {
  const update = codexRateLimitUpdates()
  const name = 'account/rateLimits/updated'
  const buckets = { codex: { primary }, spark: { limitName: 'Spark', primary } }
  expect(
    reportedPlanLimits('codex', name, update(name, { rateLimitsByLimitId: buckets })),
  ).toHaveLength(2)
  const changed = update(name, {
    rateLimitsByLimitId: {
      ...buckets,
      spark: { ...buckets.spark, primary: { ...primary, usedPercent: 25 } },
    },
  })
  expect(reportedPlanLimits('codex', name, changed)).toMatchObject([
    { bucketId: 'spark', usedPercent: 25 },
  ])
  expect(reportedPlanLimits('codex', name, changed)).toHaveLength(1)
  expect(update(name, { rateLimitsByLimitId: { codex: { primary } } })).toBeUndefined()
  expect(
    update(name, { rateLimits: { limitId: 'spark', primary: { usedPercent: 25 } } }),
  ).toBeUndefined()
  expect(update(name, {})).toBeUndefined()
})

it('publishes identical windows again when the warm transport reports a different account', () => {
  const update = codexRateLimitUpdates()
  const account = (email: string) => ({ account: { type: 'chatgpt', email, planType: 'pro' } })
  const payload = { rateLimits: { primary, secondary } }
  update('account/read', account('first@example.test'))
  expect(update('account/rateLimits/read', payload)).toBeDefined()
  update('account/read', account('first@example.test'))
  expect(update('account/rateLimits/read', payload)).toBeUndefined()
  update('account/read', account('second@example.test'))
  expect(update('account/rateLimits/read', payload)).toBeDefined()
  update('account/read', { account: null })
  expect(update('account/rateLimits/read', payload)).toBeDefined()
})
