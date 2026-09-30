import { describe, expect, it } from 'vitest'
import {
  reportedPlanLimits,
  accountPlanLimits,
  accountLimitGroups,
  formatQuotaReset,
} from './plan-limits.js'

describe('reportedPlanLimits', () => {
  it('reads Codex windows only when a percentage is reported', () => {
    const limits = reportedPlanLimits('codex', 'account/rateLimits/read', {
      rateLimits: {
        primary: { usedPercent: 38, windowDurationMins: 300, resetsAt: 1_800_000_000 },
        secondary: { windowDurationMins: 10080 },
      },
    })
    expect(limits).toMatchObject([
      { provider: 'codex', window: '5-hour', usedPercent: 38, resetsAt: 1_800_000_000 },
    ])
  })

  it('converts Claude utilization to percent', () => {
    expect(
      reportedPlanLimits('claude', 'rate_limit_event', {
        rate_limit_info: { rateLimitType: 'five_hour', utilization: 0.62 },
      }),
    ).toMatchObject([{ provider: 'claude', window: '5-hour', usedPercent: 62 }])
    expect(
      reportedPlanLimits('claude', 'rate_limit_event', {
        rate_limit_info: { rateLimitType: 'five_hour' },
      }),
    ).toEqual([])
  })
})

it('uses the newest quota snapshot per account across computers without adding percentages', () => {
  const account = { id: 'subscription-a', label: 'A', subscription: 'pro' }
  const now = Date.parse('2026-09-30T12:00:00Z')
  const limit = {
    provider: 'codex' as const,
    window: '5-hour',
    account,
    usedPercent: 30,
    updatedAt: '2026-09-30T11:00:00Z',
    resetsAt: now / 1000 - 1,
  }
  const windows = accountPlanLimits(
    [
      { computer: 'Mac', limits: [limit] },
      {
        computer: 'Linux',
        limits: [{ ...limit, usedPercent: 50, updatedAt: '2026-09-30T11:30:00Z' }],
      },
      { computer: 'Other', limits: [{ ...limit, account: { id: 'subscription-b', label: 'B' } }] },
    ],
    now,
  )
  expect(windows).toHaveLength(2)
  expect(windows[0]).toMatchObject({ usedPercent: 50, computers: ['Mac', 'Linux'] })
  expect(accountLimitGroups(windows).filter((group) => group.windows.length)).toHaveLength(2)
  expect(formatQuotaReset(limit.resetsAt, now)).toContain('awaiting a fresh reading')
  expect(formatQuotaReset(now / 1000 + 3900, now)).toContain('Resets in 1h 5m')
})
it('never merges unidentified accounts just because their computers have the same name', () => {
  const limit = {
    provider: 'claude' as const,
    window: '7-day',
    usedPercent: 10,
    updatedAt: '2026-09-28T12:00:00Z',
  }
  expect(
    accountPlanLimits(
      [
        { computer: 'Server', sourceId: 'a', limits: [limit] },
        { computer: 'Server', sourceId: 'b', limits: [limit] },
      ],
      Date.parse('2026-09-30T12:00:00Z'),
    ),
  ).toHaveLength(2)
})
