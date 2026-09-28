import { describe, expect, it } from 'vitest'
import { reportedPlanLimits } from './plan-limits.js'

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
