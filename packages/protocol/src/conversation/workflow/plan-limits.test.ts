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
      { provider: 'codex', window: 'Session', usedPercent: 38, resetsAt: 1_800_000_000 },
    ])
  })

  it('converts Claude utilization to percent', () => {
    expect(
      reportedPlanLimits('claude', 'rate_limit_event', {
        rate_limit_info: { rateLimitType: 'five_hour', utilization: 0.62 },
      }),
    ).toMatchObject([{ provider: 'claude', window: 'Session', usedPercent: 62 }])
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

it('keeps named Codex buckets separate and preserves sparse window metadata', async () => {
  const { mergePlanLimits } = await import('./plan-limits.js')
  const primary = { usedPercent: 20, windowDurationMins: 300, resetsAt: 2_000_000_000 }
  const limits = reportedPlanLimits('codex', 'account/rateLimits/read', {
    rateLimitsByLimitId: {
      codex: { primary },
      spark: { limitName: 'Spark', primary: { ...primary, usedPercent: 80 } },
    },
  })
  expect(limits).toHaveLength(2)
  const sparse = reportedPlanLimits('codex', 'account/rateLimits/updated', {
    rateLimits: { limitId: 'codex', primary: { usedPercent: 21 } },
  })
  const merged = mergePlanLimits(limits, sparse)
  expect(merged).toHaveLength(2)
  expect(merged.find((limit) => limit.bucketId === 'codex')).toMatchObject({
    window: 'Session',
    usedPercent: 21,
    resetsAt: 2_000_000_000,
    durationMins: 300,
  })
})
it('isolates unknown host accounts by configuration and marks old readings stale', async () => {
  const { quotaReadingState } = await import('./plan-limits.js')
  const now = Date.parse('2026-10-02T12:00:00Z')
  const limit = {
    provider: 'codex' as const,
    window: 'Session',
    usedPercent: 30,
    updatedAt: '2026-10-02T11:00:00Z',
  }
  const windows = accountPlanLimits(
    [
      {
        computer: 'Mac',
        sourceId: 'host',
        limits: [
          { ...limit, agentId: 'one' },
          { ...limit, agentId: 'two' },
        ],
      },
    ],
    now,
  )
  expect(windows).toHaveLength(2)
  expect(quotaReadingState(limit, true, now)).toBe('stale')
  expect(quotaReadingState(limit, false, now)).toBe('offline')
})
it('accepts dynamically named Claude model windows', () => {
  expect(
    reportedPlanLimits('claude', 'account/usage/read', {
      rate_limits: {
        model_scoped: [
          { display_name: 'New model', utilization: 45, resets_at: '2026-10-03T12:00:00Z' },
        ],
      },
    }),
  ).toMatchObject([{ window: 'Weekly · New model', usedPercent: 45, windowId: 'model:New model' }])
})
