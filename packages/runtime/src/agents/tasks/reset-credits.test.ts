import { expect, it } from 'vite-plus/test'
import { claudeCredits, codexCredits, claudeQuotaLimits } from './reset-credits'
it('reads Codex banked credits with epoch expiry and excludes expired or unknown credits', () => {
  const now = Date.parse('2026-09-30T12:00:00Z')
  const raw = {
    rateLimitResetCredits: {
      availableCount: 1,
      credits: [
        {
          id: 'a',
          status: 'available',
          resetType: 'codexRateLimits',
          title: 'Full reset',
          expiresAt: now / 1000 + 3600,
        },
        { id: 'old', status: 'available', resetType: 'codexRateLimits', expiresAt: now / 1000 - 1 },
        { id: 'unknown', status: 'unknown', resetType: 'unknown', expiresAt: null },
      ],
    },
  }
  expect(codexCredits(raw, now)).toEqual({
    supported: true,
    availableCount: 1,
    credits: [{ id: 'a', title: 'Full reset', expiresAt: '2026-09-30T13:00:00.000Z' }],
  })
  expect(codexCredits({})).toMatchObject({ supported: false })
})
it('counts only usable Claude grants and puts the next grant first', () => {
  const now = Date.parse('2026-09-30T12:00:00Z')
  expect(
    claudeCredits(
      {
        cedar_ember: {
          eligible: true,
          next_grant_id: 'next',
          grants: [
            { id: 'later', resets_left: 2, usable_now: true, ends_at: '2026-10-02T00:00:00Z' },
            { id: 'next', resets_left: 1, usable_now: true, ends_at: '2026-10-01T00:00:00Z' },
            { id: 'old', resets_left: 10, usable_now: true, ends_at: '2026-09-01T00:00:00Z' },
            { id: 'paused', resets_left: 10, usable_now: true, paused: true },
          ],
        },
      },
      now,
    ),
  ).toMatchObject({
    supported: true,
    availableCount: 3,
    credits: [{ id: 'next' }, { id: 'later' }],
  })
  expect(claudeCredits({ cedar_ember: { eligible: false } }).supported).toBe(false)
})

it('refreshes Claude quota percentages without mistaking OAuth percentages for SDK fractions', () => {
  expect(
    claudeQuotaLimits({ five_hour: { utilization: 62, resets_at: '2026-10-01T00:00:00Z' } }),
  ).toMatchObject([
    {
      provider: 'claude',
      window: 'Session',
      usedPercent: 62,
      resetsAt: Date.parse('2026-10-01T00:00:00Z') / 1000,
    },
  ])
})
