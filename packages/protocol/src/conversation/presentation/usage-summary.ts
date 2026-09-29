import type { Task } from '../../workspace.js'

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
export type UsageSummary = { total: UsageRow; models: UsageRow[]; tasks: UsageRow[] }

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
  sources: readonly { computer: string; tasks: readonly Task[] }[],
  since: number,
  now = Date.now(),
): UsageSummary {
  const total = empty('total', 'All agents')
  const models = new Map<string, UsageRow>()
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
        const taskKey = `${source.computer}\u0000${task.id}`
        const rows = [
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
    models: [...models.values()].sort(busiest),
    tasks: [...tasks.values()].sort(busiest).slice(0, 10),
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
