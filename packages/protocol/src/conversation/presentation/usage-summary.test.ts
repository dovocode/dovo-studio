import { expect, it } from 'vite-plus/test'
import {
  createUsageSummary,
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
    ['GPT-5-Mini', 1],
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
      {
        computer: 'Mac',
        tasks: [
          task('a', [
            { ...recent, usageAccount: account },
            { ...recent, id: 'unknown' },
          ]),
        ],
      },
      {
        computer: 'Linux',
        tasks: [
          task('b', [
            { ...recent, usageAccount: account },
            { ...recent, id: 'unknown' },
          ]),
        ],
      },
    ],
    Date.parse('2026-09-28T00:00:00Z'),
  )
  expect(summary.accounts).toHaveLength(3)
  expect(summary.accounts.find((row) => row.label === account.label)).toMatchObject({
    turns: 2,
    tokens: 200,
  })
})

it('reuses usage totals when only task messages or tool metadata change', () => {
  const project = createUsageSummary()
  const recent = turn('2026-09-29T00:00:00Z', 1, 'gpt-6-sol', 100)
  const work = task('work', [recent])
  const sources = [{ id: 'mac', computer: 'Mac', tasks: [work] }]
  const now = Date.parse('2026-09-29T01:00:00Z')
  const first = project(sources, 0, now)
  const updatedTask = { ...work, draft: 'new text', turns: [{ ...recent }] }
  expect(project([{ ...sources[0], tasks: [updatedTask] }], 0, now)).toBe(first)
  expect(
    project([{ ...sources[0], tasks: [task('work', [{ ...recent, tokens: 200 }])] }], 0, now).total
      .tokens,
  ).toBe(200)
})
it('updates live elapsed time and period boundaries without a new snapshot', () => {
  const project = createUsageSummary()
  const started = '2026-09-29T00:00:00Z'
  const running = {
    ...turn(started, 1, 'gpt-6-sol'),
    finishedAt: undefined,
    status: 'running' as const,
  }
  const work = { ...task('work', []), turns: [running] }
  const sources = [{ computer: 'Mac', tasks: [work] }]
  const start = Date.parse(started)
  expect(project(sources, start, start + 60000).total.durationMs).toBe(60000)
  expect(project(sources, start, start + 120000).total.durationMs).toBe(120000)
  expect(project(sources, start + 1, start + 120000).total.turns).toBe(0)
})
it('keeps equally named computers and identical thread ids separate', () => {
  const work = task('same-id', [turn('2026-09-29T00:00:00Z', 1, 'gpt-6-sol')])
  const result = usageSummary(
    [
      { id: 'first', computer: 'Mac', tasks: [work] },
      { id: 'second', computer: 'Mac', tasks: [work] },
    ],
    0,
  )
  expect(result.tasks).toHaveLength(2)
  expect(result.accounts).toHaveLength(2)
  expect(result.total.turns).toBe(2)
})

it('deduplicates aliases of the same runtime and includes durable deleted threads', () => {
  const recent = turn('2026-10-01T00:00:00Z', 1, 'gpt-6.1-sol', 100)
  const source = {
    computer: 'Mac',
    sourceId: 'stable-runtime',
    tasks: [task('t', [recent])],
    records: [{ taskId: 'deleted', title: 'Deleted thread', turn: { ...recent, id: 'other' } }],
  }
  const summary = usageSummary(
    [
      { ...source, id: 'alias-one' },
      { ...source, id: 'alias-two' },
    ],
    0,
  )
  expect(summary.total.turns).toBe(2)
  expect(summary.tasks.some((row) => row.label === 'Deleted thread')).toBe(true)
  expect(summary.models[0]?.label).toBe('GPT-6.1-Sol')
})
it('excludes future observations and preserves cache breakdowns', () => {
  const recent = {
    ...turn('2026-10-01T00:00:00Z', 1, 'gpt-6.1-sol', 100),
    tokenUsage: { input: 10, output: 20, cacheRead: 60, cacheWrite: 10 },
  }
  const summary = usageSummary(
    [
      {
        computer: 'Mac',
        tasks: [task('t', [recent, turn('2027-01-01T00:00:00Z', 1, 'gpt-6.1-sol', 100)])],
      },
    ],
    0,
    Date.parse('2026-10-02T00:00:00Z'),
  )
  expect(summary.total).toMatchObject({
    turns: 1,
    input: 10,
    output: 20,
    cacheRead: 60,
    cacheWrite: 10,
  })
})

it('counts copied CLI requests once across different hosts', () => {
  const recent = turn('2026-10-01T00:00:00Z', 1, 'gpt-6.1-sol', 100)
  const record = {
    taskId: 'cli:session',
    title: 'Codex CLI',
    sessionId: 'session',
    origin: 'cli' as const,
    turn: recent,
  }
  const result = usageSummary(
    [
      { computer: 'Mac', sourceId: 'one', tasks: [], records: [record] },
      { computer: 'Linux', sourceId: 'two', tasks: [], records: [record] },
    ],
    0,
  )
  expect(result.total).toMatchObject({ turns: 1, tokens: 100 })
})
