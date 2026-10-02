import type { Task } from '../../workspace.js'

export type UsageTask = Pick<Task, 'id' | 'title' | 'example' | 'turns'>
export type UsageSource = { id?: string; computer: string; tasks: readonly UsageTask[] }

export type UsageRow = {
  key: string
  label: string
  detail?: string
  turns: number
  failed: number
  durationMs: number
  /** Tokens from turns that reported them; `tokenTurns` says how many did. */
  tokens: number
  tokenTurns: number
  estimatedCostUsd: number
  pricedTurns: number
}
export type UsageSummary = {
  total: UsageRow
  models: UsageRow[]
  accounts: UsageRow[]
  tasks: UsageRow[]
}

const empty = (key: string, label: string, detail?: string): UsageRow => ({
  key,
  label,
  ...(detail ? { detail } : {}),
  turns: 0,
  failed: 0,
  durationMs: 0,
  tokens: 0,
  tokenTurns: 0,
  estimatedCostUsd: 0,
  pricedTurns: 0,
})

/** Time, turns and tokens of agent turns that started since `since`, across computers, per
 * model and per task (busiest first). */
export function usageSummary(
  sources: readonly UsageSource[],
  since: number,
  now = Date.now(),
): UsageSummary {
  const total = empty('total', 'All agents')
  const models = new Map<string, UsageRow>()
  const accounts = new Map<string, UsageRow>()
  const tasks = new Map<string, UsageRow>()
  for (const source of sources)
    for (const task of source.tasks) {
      if (task.example) continue
      for (const turn of task.turns ?? []) {
        const started = Date.parse(turn.startedAt)
        if (!Number.isFinite(started) || started < since) continue
        const finished = turn.finishedAt ? Date.parse(turn.finishedAt) : now
        const duration = Number.isFinite(finished) ? Math.max(0, finished - started) : 0
        const modelKey = `${turn.provider}\u0000${turn.model}`
        const taskKey = `${source.id ?? source.computer}\u0000${task.id}`
        const accountKey = JSON.stringify([
          turn.provider,
          turn.usageAccount?.id ?? `unknown:${source.id ?? source.computer}:${turn.agentId}`,
        ])
        const rows = [
          accounts.get(accountKey) ??
            accounts
              .set(
                accountKey,
                empty(
                  accountKey,
                  turn.usageAccount?.label ?? 'Unidentified account',
                  `${turn.provider}${turn.usageAccount?.subscription ? ` · ${turn.usageAccount.subscription}` : ''}${turn.usageAccount ? '' : ` · ${source.computer}`}`,
                ),
              )
              .get(accountKey)!,
          total,
          models.get(modelKey) ??
            models
              .set(modelKey, empty(modelKey, turn.model || 'Default model', turn.provider))
              .get(modelKey)!,
          tasks.get(taskKey) ??
            tasks.set(taskKey, empty(taskKey, task.title, source.computer)).get(taskKey)!,
        ]
        for (const row of rows) {
          row.turns++
          if (turn.status === 'failed') row.failed++
          row.durationMs += duration
          if (turn.tokens !== undefined) {
            row.tokens += turn.tokens
            row.tokenTurns++
          }
          if (turn.estimatedCostUsd !== undefined) {
            row.estimatedCostUsd += turn.estimatedCostUsd
            row.pricedTurns++
          }
        }
      }
    }
  const busiest = (a: UsageRow, b: UsageRow) => b.durationMs - a.durationMs || b.turns - a.turns
  return {
    total,
    accounts: [...accounts.values()].sort(busiest),
    models: [...models.values()].sort(busiest),
    tasks: [...tasks.values()].sort(busiest).slice(0, 10),
  }
}

/** Reuse totals when streaming changes messages or tools, but not usage inputs. */
export function createUsageSummary() {
  let previous:
    | { sources: UsageSource[]; since: number; now: number; summary: UsageSummary }
    | undefined
  const sameTurns = (a: UsageTask['turns'], b: UsageTask['turns']) =>
    a === b ||
    (a?.length === b?.length &&
      (a ?? []).every((turn, index) => {
        const other = b?.[index]
        return (
          other !== undefined &&
          turn.startedAt === other.startedAt &&
          turn.finishedAt === other.finishedAt &&
          turn.status === other.status &&
          turn.provider === other.provider &&
          turn.model === other.model &&
          turn.agentId === other.agentId &&
          turn.tokens === other.tokens &&
          turn.estimatedCostUsd === other.estimatedCostUsd &&
          turn.usageAccount?.id === other.usageAccount?.id &&
          turn.usageAccount?.label === other.usageAccount?.label &&
          turn.usageAccount?.subscription === other.usageAccount?.subscription
        )
      }))
  return (sources: readonly UsageSource[], since: number, now = Date.now()) => {
    if (
      previous &&
      previous.since === since &&
      previous.now === now &&
      sources.length === previous.sources.length &&
      sources.every((source, index) => {
        const old = previous?.sources[index]
        return (
          old &&
          source.id === old.id &&
          source.computer === old.computer &&
          source.tasks.length === old.tasks.length &&
          source.tasks.every(
            (task, i) =>
              task.id === old.tasks[i]?.id &&
              task.title === old.tasks[i]?.title &&
              task.example === old.tasks[i]?.example &&
              sameTurns(task.turns, old.tasks[i]?.turns),
          )
        )
      })
    )
      return previous.summary
    const summary = usageSummary(sources, since, now)
    previous = {
      since,
      now,
      summary,
      sources: sources.map((source) => ({
        id: source.id,
        computer: source.computer,
        tasks: source.tasks.map(({ id, title, example, turns }) => ({ id, title, example, turns })),
      })),
    }
    return summary
  }
}

export function formatUsageDuration(ms: number) {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return ms > 0 ? '<1m' : '0m'
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}
export function formatUsageTokens(tokens: number) {
  return tokens >= 1_000_000
    ? `${(tokens / 1_000_000).toFixed(1)}M`
    : tokens >= 1000
      ? `${Math.round(tokens / 1000)}k`
      : String(tokens)
}
export function formatUsageCost(usd: number) {
  return usd < 0.01 && usd > 0 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`
}
