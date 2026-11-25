import { expect, it } from 'vite-plus/test'
import type { PlanLimit } from '@dovo/protocol'
import { quotaFailureTiming } from './quota-continuation'

const now = Date.parse('2026-10-04T12:00:00Z')
const limit: PlanLimit = {
  provider: 'codex',
  window: 'Session',
  usedPercent: 100,
  resetsAt: now / 1000 + 3600,
  updatedAt: new Date(now).toISOString(),
}

it('requires a quota error with an unambiguous future reset', () => {
  for (const [error, limits] of [
    ['Network offline', [limit]],
    ['Usage limit reached', []],
    ['Usage limit reached', [{ ...limit, usedPercent: 99 }]],
    ['Usage limit reached', [{ ...limit, resetsAt: undefined }]],
    ['Usage limit reached', [{ ...limit, resetsAt: now / 1000 }]],
    ['Usage limit reached. Resets at 2pm.', []],
    ['529 Provider overloaded. Retry-After: 20', []],
  ] as const) {
    expect(quotaFailureTiming(error, limits, { quotaResume: true }, 'turn', now)).toEqual({})
  }
})

it('uses the latest exhausted window and keeps project policy separate from the offer', () => {
  const weekly = { ...limit, window: 'Weekly', resetsAt: now / 1000 + 7200 }
  const at = new Date(now + 7200000).toISOString()
  for (const [policy, continuation] of [
    [{}, undefined],
    [{ quotaSnooze: true }, { turnId: 'turn', at, resume: false }],
    [{ quotaResume: true }, { turnId: 'turn', at, resume: true }],
  ] as const) {
    expect(quotaFailureTiming('Rate limit exceeded', [limit, weekly], policy, 'turn', now)).toEqual(
      {
        quotaRetryAt: at,
        continuation,
      },
    )
  }
})

it.each([
  ['Provider reported a usage limit', now + 282000, now + 282000],
  ['429 Too Many Requests. Retry-After: 12.5', undefined, now + 12500],
  ['Rate limit exceeded. Please try again in 4m42s.', undefined, now + 282000],
  ['Usage limit reached. Resets at 2026-10-04T15:00:00+02:00.', undefined, now + 3600000],
])('uses the provider retry time in %s', (error, providerResetAt, expected) => {
  expect(quotaFailureTiming(error, [], {}, 'turn', now, providerResetAt)).toEqual({
    quotaRetryAt: new Date(expected).toISOString(),
  })
})
