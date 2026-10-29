import { describe, expect, it } from 'vite-plus/test'
import {
  reportedPlanLimits,
  mergePlanLimits,
  accountPlanLimits,
  accountLimitGroups,
  formatQuotaReset,
} from './plan-limits.js'

it('keeps newer account observations when delayed snapshots arrive', () => {
  const latest = {
    provider: 'codex' as const,
    account: { id: 'account', label: 'Account' },
    bucketId: 'codex',
    windowId: 'primary',
    window: 'Session',
    usedPercent: 40,
    updatedAt: '2026-10-29T10:00:02.000Z',
  }
  for (const updatedAt of ['2026-10-29T10:00:01.000Z', 'invalid'])
    expect(mergePlanLimits([latest], [{ ...latest, usedPercent: 20, updatedAt }])).toEqual([latest])
  expect(
    mergePlanLimits(
      [latest],
      [{ ...latest, usedPercent: 0, updatedAt: '2026-10-29T10:00:03.000Z' }],
    ),
  ).toMatchObject([{ usedPercent: 0 }])
})

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

it('pools deduplicated account segments, applies only overall weekly gates, and keeps order across windows', async () => {
  const { pooledPlanLimits } = await import('./plan-limits.js')
  const now = Date.now()
  const row = (id: string, window: string, usedPercent: number) => ({
    provider: 'claude' as const,
    account: { id, label: id },
    window,
    windowId: window,
    usedPercent,
    updatedAt: new Date(now).toISOString(),
    resetsAt: now / 1000 + 3600,
  })
  const rows = [
    row('a', 'Session', 10),
    row('a', 'Weekly', 100),
    row('b', 'Session', 20),
    row('b', 'Weekly', 10),
    row('b', 'Weekly · Opus', 100),
  ]
  const pools = pooledPlanLimits(
    accountPlanLimits(
      [
        { computer: 'Mac', limits: rows },
        { computer: 'Linux', limits: rows },
      ],
      now,
    ),
    now,
  )
  const session = pools.find((pool) => pool.window === 'Session')!
  expect(session.segments).toHaveLength(2)
  expect(session.available).toBe(1)
  expect(session.segments).toMatchObject([
    { accountKey: 'a', remaining: 0, gatedByWeekly: true },
    { accountKey: 'b', remaining: 80, gatedByWeekly: false },
  ])
  expect(session.nextReset).toBe(now / 1000 + 3600)
  expect(
    pools.every((pool) => pool.segments.map((segment) => segment.accountKey).join(',') === 'a,b'),
  ).toBe(true)
  expect(pools.find((pool) => pool.window === 'Weekly · Opus')?.unknown).toBe(1)
})
it('does not turn stale, offline or reset-expired observations into pooled availability', async () => {
  const { pooledPlanLimits } = await import('./plan-limits.js')
  const now = Date.now()
  const row = {
    provider: 'codex' as const,
    window: 'Session',
    usedPercent: 1,
    updatedAt: new Date(now).toISOString(),
  }
  const sources = [
    {
      computer: 'offline',
      connected: false,
      limits: [{ ...row, account: { id: 'offline', label: 'Offline' } }],
    },
    {
      computer: 'stale',
      limits: [
        {
          ...row,
          account: { id: 'stale', label: 'Stale' },
          updatedAt: new Date(now - 600001).toISOString(),
        },
      ],
    },
    {
      computer: 'expired',
      limits: [{ ...row, account: { id: 'expired', label: 'Expired' }, resetsAt: now / 1000 - 1 }],
    },
  ]
  const pool = pooledPlanLimits(accountPlanLimits(sources, now), now)[0]!
  expect(pool.available).toBe(0)
  expect(pool.unknown).toBe(3)
  expect(pool.segments.every((segment) => segment.remaining === null)).toBe(true)
})
it('does not label a newer failed hub reading fresh just because the same account is connected elsewhere', () => {
  const now = Date.now(),
    account = { id: 'same', label: 'Account' }
  const row = {
    provider: 'codex' as const,
    window: 'Session',
    usedPercent: 20,
    account,
    updatedAt: new Date(now - 1000).toISOString(),
  }
  const [result] = accountPlanLimits(
    [
      { computer: 'Mac', connected: true, limits: [row] },
      {
        computer: 'Hub',
        connected: false,
        limits: [{ ...row, updatedAt: new Date(now).toISOString() }],
      },
    ],
    now,
  )
  expect(result?.connected).toBe(false)
})

it('waits for all depleted account windows and treats an expired weekly gate as unknown', async () => {
  const { pooledPlanLimits } = await import('./plan-limits.js')
  const now = Date.now()
  const row = {
    provider: 'codex' as const,
    account: { id: 'account', label: 'Account' },
    updatedAt: new Date(now).toISOString(),
    usedPercent: 100,
  }
  const project = (weeklyReset: number) =>
    pooledPlanLimits(
      accountPlanLimits(
        [
          {
            computer: 'Mac',
            limits: [
              { ...row, window: 'Session', resetsAt: now / 1000 + 7200 },
              { ...row, window: 'Weekly', resetsAt: weeklyReset },
            ],
          },
        ],
        now,
      ),
      now,
    ).find((pool) => pool.window === 'Session')!
  expect(project(now / 1000 + 3600).nextReset).toBe(now / 1000 + 7200)
  expect(project(now / 1000 - 1).unknown).toBe(1)
})

it('keeps never-reported hub accounts visible as unknown without counting unsupported subscriptions', async () => {
  const { pooledPlanLimits, hubPlanLimitSources } = await import('./plan-limits')
  const accounts = [
    {
      id: 'a',
      provider: 'codex' as const,
      account: { id: 'good', label: 'Good' },
      status: 'ok' as const,
    },
    {
      id: 'b',
      provider: 'codex' as const,
      account: { id: 'bad', label: 'Bad' },
      status: 'failed' as const,
    },
    {
      id: 'c',
      provider: 'codex' as const,
      account: { id: 'api', label: 'API' },
      status: 'unsupported' as const,
    },
  ]
  const hub = {
    id: 'hub',
    label: 'Hub',
    url: 'http://hub/',
    enabled: true,
    error: '1 account failed',
    accounts,
    limits: [
      {
        provider: 'codex' as const,
        window: 'Session',
        account: accounts[0]!.account,
        usedPercent: 25,
        updatedAt: new Date().toISOString(),
      },
    ],
  }
  const windows = accountPlanLimits(
    hubPlanLimitSources(hub, { computer: 'Host', sourceId: 'hub', connected: true }),
  )
  const pool = pooledPlanLimits(windows, Date.now(), accounts)[0]!
  expect(pool.segments).toHaveLength(2)
  expect(pool.available).toBe(1)
  expect(pool.unknown).toBe(1)
  expect(pool.segments.find((segment) => segment.accountKey === 'bad')?.remaining).toBeNull()
})

it('attributes anonymous windows without replacing newer observations with older account probes', () => {
  const account = { id: 'account', label: 'Account' }
  const anonymous = {
    provider: 'codex' as const,
    sourceTaskId: 'task',
    bucketId: 'codex',
    windowId: 'primary',
    window: 'Session',
    usedPercent: 90,
    updatedAt: '2026-10-29T20:00:00.000Z',
    resetsAt: 2000000000,
  }
  const incoming = { ...anonymous, account, usedPercent: 50, updatedAt: '2026-10-29T19:00:00.000Z' }
  expect(mergePlanLimits([anonymous], [incoming])).toEqual([{ ...anonymous, account }])
  const latest = { ...incoming, usedPercent: 95, updatedAt: '2026-10-29T21:00:00.000Z' }
  expect(mergePlanLimits([anonymous, latest], [incoming])).toEqual([latest])
  const other = { ...anonymous, sourceTaskId: 'other' }
  expect(mergePlanLimits([other], [incoming])).toEqual([other, incoming])
})
