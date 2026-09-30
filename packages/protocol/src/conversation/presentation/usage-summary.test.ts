import { expect, it } from 'vitest'
import {
  formatUsageCost,
  formatUsageDuration,
  formatUsageTokens,
  usageSummary,
} from './usage-summary.js'
import type { Task } from '../../workspace.js'

const turn = (
  startedAt: string,
  minutes: number,
  model: string,
  tokens?: number,
  status = 'completed',
) => ({
  id: startedAt,
  assistantId: startedAt,
  agentId: 'a',
  provider: 'codex' as const,
  model,
  startedAt,
  finishedAt: new Date(Date.parse(startedAt) + minutes * 60_000).toISOString(),
  status: status as 'completed' | 'failed',
  ...(tokens !== undefined ? { tokens } : {}),
})
const task = (
  id: string,
  turns: (ReturnType<typeof turn> & {
    usageAccount?: { id: string; label: string; subscription?: string }
  })[],
) => ({ id, title: id, example: false, turns }) as unknown as Task

it('sums recent turns per model and per task', () => {
  const since = Date.parse('2026-09-20T00:00:00Z')
  const summary = usageSummary(
    [
      {
        computer: 'Mac',
        tasks: [
          task('auth', [
            turn('2026-09-10T00:00:00Z', 60, 'gpt-5'),
            turn('2026-09-21T00:00:00Z', 30, 'gpt-5', 10_000),
            turn('2026-09-22T00:00:00Z', 10, 'gpt-5-mini', undefined, 'failed'),
          ]),
        ],
      },
      {
        computer: 'Server',
        tasks: [task('docs', [turn('2026-09-23T00:00:00Z', 5, 'gpt-5', 2_000)])],
      },
    ],
    since,
  )
  expect(summary.total).toMatchObject({
    turns: 3,
    failed: 1,
    durationMs: 45 * 60_000,
    tokens: 12_000,
    tokenTurns: 2,
  })
  expect(summary.models.map((row) => [row.label, row.turns])).toEqual([
    ['gpt-5', 2],
    ['gpt-5-mini', 1],
  ])
  expect(summary.tasks.map((row) => [row.label, row.detail])).toEqual([
    ['auth', 'Mac'],
    ['docs', 'Server'],
  ])
  expect(formatUsageDuration(125 * 60_000)).toBe('2h 05m')
  expect(formatUsageTokens(12_345)).toBe('12k')
  expect(formatUsageCost(0.0025)).toBe('$0.0025')
})

it('sums only locally priced turns and reports partial coverage', () => {
  const priced = { ...turn('2026-09-21T00:00:00Z', 1, 'gpt-6-sol', 100), estimatedCostUsd: 0.001 }
  const unpriced = turn('2026-09-22T00:00:00Z', 1, 'gpt-6-sol', 100)
  const summary = usageSummary(
    [{ computer: 'Mac', tasks: [task('work', [priced, unpriced])] }],
    Date.parse('2026-09-20T00:00:00Z'),
  )
  expect(summary.total).toMatchObject({ estimatedCostUsd: 0.001, pricedTurns: 1, turns: 2 })
  expect(summary.models[0]).toMatchObject({ estimatedCostUsd: 0.001, pricedTurns: 1 })
})

it('sums local turn usage by subscription across machines and keeps unknown turns separate', () => {
  const account = { id: 'same-subscription', label: 'account@example.com', subscription: 'pro' }
  const recent = turn('2026-09-29T00:00:00Z', 1, 'gpt-5', 100)
  const summary = usageSummary(
    [
      { computer: 'Mac', tasks: [task('a', [{ ...recent, usageAccount: account }, recent])] },
      { computer: 'Linux', tasks: [task('b', [{ ...recent, usageAccount: account }, recent])] },
    ],
    Date.parse('2026-09-28T00:00:00Z'),
  )
  expect(summary.accounts).toHaveLength(3)
  expect(summary.accounts.find((row) => row.label === account.label)).toMatchObject({
    turns: 2,
    tokens: 200,
  })
})
