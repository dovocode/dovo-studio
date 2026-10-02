import { modelDisplayName } from '../../tasks/models.js'
import type { UsageRecord } from './usage-history.js'
import type { Task } from '../../workspace.js'

export type UsageTask = Pick<Task, 'id' | 'title' | 'example' | 'turns'>
export type UsageSource = {
  id?: string
  sourceId?: string
  computer: string
  tasks: readonly UsageTask[]
  records?: readonly UsageRecord[]
}

export type UsageRow = {
  key: string
  label: string
  detail?: string
  turns: number
  failed: number
  durationMs: number
  /** Tokens from turns that reported them; `tokenTurns` says how many did. */
  tokens: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  tokenTurns: number
  estimatedCostUsd: number
  pricedTurns: number
}
export type UsageSummary = {
  total: UsageRow
  models: UsageRow[]
  accounts: UsageRow[]
  tasks: UsageRow[]
  days: UsageRow[]
  hours: UsageRow[]
}

const empty = (key: string, label: string, detail?: string): UsageRow => ({
  key,
  label,
  ...(detail ? { detail } : {}),
  turns: 0,
  failed: 0,
  durationMs: 0,
  tokens: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
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
  const days = new Map<string, UsageRow>()
  const hours = new Map<string, UsageRow>()
  const seen = new Set<string>()
  const knownSessions = new Set(
    sources.flatMap((source) =>
      (source.records ?? []).flatMap((record) =>
        record.origin !== 'cli' && record.sessionId
          ? [`${record.turn.provider}:${record.sessionId}`]
          : [],
      ),
    ),
  )
  for (const source of sources) {
    const saved = new Map<string, UsageTask>()
    const externalIds = new Set<string>()
    for (const record of source.records ?? []) {
      if (record.origin === 'cli') {
        if (record.sessionId && knownSessions.has(`${record.turn.provider}:${record.sessionId}`))
          continue
        externalIds.add(JSON.stringify([record.taskId, record.turn.id]))
      }
      const task = saved.get(record.taskId) ?? {
        id: record.taskId,
        title: record.title,
        example: false,
        turns: [],
      }
      const turns = task.turns ?? []
      turns.push(record.turn)
      saved.set(record.taskId, { ...task, turns })
    }
    for (const task of source.tasks) {
      const old = saved.get(task.id)
      const turns = new Map((old?.turns ?? []).map((turn) => [turn.id, turn]))
      for (const turn of task.turns ?? []) {
        const stored = turns.get(turn.id)
        // Prefer repriced durable records only when they describe this exact observation.
        if (
          !stored ||
          stored.finishedAt !== turn.finishedAt ||
          stored.tokens !== turn.tokens ||
          stored.status !== turn.status
        )
          turns.set(turn.id, turn)
      }
      saved.set(task.id, { ...task, turns: [...turns.values()] })
    }
    for (const task of saved.values()) {
      if (task.example) continue
      for (const turn of task.turns ?? []) {
        const started = Date.parse(turn.startedAt)
        if (!Number.isFinite(started) || started < since || started > now) continue
        const identity = externalIds.has(JSON.stringify([task.id, turn.id]))
          ? JSON.stringify(['cli', turn.provider, turn.id])
          : JSON.stringify([
              turn.runtimeHost ?? source.sourceId ?? source.id ?? source.computer,
              task.id,
              turn.id,
            ])
        if (seen.has(identity)) continue
        seen.add(identity)
        const finished = turn.finishedAt ? Date.parse(turn.finishedAt) : now
        const duration = Number.isFinite(finished) ? Math.max(0, finished - started) : 0
        const modelKey = `${turn.provider}\u0000${turn.model}`
        const taskKey = `${source.id ?? source.computer}\u0000${task.id}`
        const accountKey = JSON.stringify([
          turn.provider,
          turn.usageAccount?.id ?? `unknown:${source.id ?? source.computer}:${turn.agentId}`,
        ])
        const date = new Date(started)
        const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
        const dayRow = days.get(day) ?? empty(day, day)
        days.set(day, dayRow)
        const hour = new Date(Math.floor(started / 3600000) * 3600000)
        const hourKey = hour.toISOString()
        const hourRow =
          hours.get(hourKey) ??
          empty(
            hourKey,
            hour.toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            }),
          )
        hours.set(hourKey, hourRow)
        const rows = [
          hourRow,
          dayRow,
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
              .set(
                modelKey,
                empty(
                  modelKey,
                  turn.model ? modelDisplayName(turn.model) : 'Default model',
                  turn.provider,
                ),
              )
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
            row.input += turn.tokenUsage?.input ?? 0
            row.output += turn.tokenUsage?.output ?? 0
            row.cacheRead += turn.tokenUsage?.cacheRead ?? 0
            row.cacheWrite += turn.tokenUsage?.cacheWrite ?? 0
          }
          if (turn.estimatedCostUsd !== undefined) {
            row.estimatedCostUsd += turn.estimatedCostUsd
            row.pricedTurns++
          }
        }
      }
    }
  }
  const busiest = (a: UsageRow, b: UsageRow) => b.durationMs - a.durationMs || b.turns - a.turns
  return {
    total,
    hours: [...hours.values()].sort((a, b) => a.key.localeCompare(b.key)),
    days: [...days.values()].sort((a, b) => a.key.localeCompare(b.key)),
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
          turn.tokenUsage === other.tokenUsage &&
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
          source.sourceId === old.sourceId &&
          source.records === old.records &&
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
        sourceId: source.sourceId,
        records: source.records,
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

/** Calendar gaps stay visible instead of compressing quiet days out of the chart. */
export function usageChartDays(rows: readonly UsageRow[], since: number, now = Date.now()) {
  const byDay = new Map(rows.map((row) => [row.key, row]))
  const date = new Date(Math.max(since, now - 90 * 86400000))
  date.setHours(0, 0, 0, 0)
  const result: UsageRow[] = []
  while (date.getTime() <= now) {
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    result.push(byDay.get(key) ?? empty(key, key))
    date.setDate(date.getDate() + 1)
  }
  return result
}

export function usageChartHours(rows: readonly UsageRow[], since: number, now = Date.now()) {
  const byHour = new Map(rows.map((row) => [row.key, row]))
  const result: UsageRow[] = []
  for (
    let time = Math.floor(Math.max(since, now - 86400000) / 3600000) * 3600000;
    time <= now;
    time += 3600000
  ) {
    const date = new Date(time),
      key = date.toISOString()
    result.push(
      byHour.get(key) ??
        empty(
          key,
          date.toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }),
        ),
    )
  }
  return result
}
