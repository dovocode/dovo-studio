import { expect, it } from 'vite-plus/test'
import type { PlanLimit } from '@dovo/protocol'
import { quotaContinuation } from './quota-continuation'
const now = Date.parse('2026-10-04T12:00:00Z')
const limit: PlanLimit = {
  provider: 'codex',
  window: 'Session',
  usedPercent: 100,
  resetsAt: now / 1000 + 3600,
  updatedAt: new Date(now).toISOString(),
}
it('requires both a quota error and exhausted windows with future resets', () => {
  const policy = { quotaResume: true, quotaSnooze: true }
  expect(quotaContinuation('Network offline', [limit], policy, 'turn', now)).toBeUndefined()
  expect(quotaContinuation('Usage limit reached', [], policy, 'turn', now)).toBeUndefined()
  expect(
    quotaContinuation('Usage limit reached', [{ ...limit, usedPercent: 99 }], policy, 'turn', now),
  ).toBeUndefined()
  expect(
    quotaContinuation(
      'Usage limit reached',
      [{ ...limit, resetsAt: undefined }],
      policy,
      'turn',
      now,
    ),
  ).toBeUndefined()
  expect(
    quotaContinuation(
      'Usage limit reached',
      [{ ...limit, resetsAt: now / 1000 }],
      policy,
      'turn',
      now,
    ),
  ).toBeUndefined()
  expect(quotaContinuation('Usage limit reached', [limit], {}, 'turn', now)).toBeUndefined()
})
it('waits for the latest exhausted window and separates snoozing from resuming', () => {
  const weekly = { ...limit, window: 'Weekly', resetsAt: now / 1000 + 7200 }
  expect(
    quotaContinuation('Rate limit exceeded', [limit, weekly], { quotaResume: true }, 'turn', now),
  ).toEqual({ turnId: 'turn', at: new Date(now + 7200000).toISOString(), resume: true })
  expect(
    quotaContinuation('Quota exhausted', [limit], { quotaSnooze: true }, 'turn', now)?.resume,
  ).toBe(false)
})
