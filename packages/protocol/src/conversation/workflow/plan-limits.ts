import { Schema } from 'effect'
import { mutableStruct, mutableArray } from '../../shared/schema.js'
export interface PlanLimit {
  provider: 'codex' | 'claude'
  sourceTaskId?: string
  account?: { id: string; label: string; subscription?: string }
  window: string
  usedPercent: number
  resetsAt?: number
  updatedAt: string
}

/** Providers use different names and percentage scales for the same account window. */
export function reportedPlanLimits(
  provider: PlanLimit['provider'],
  name: string,
  payload: unknown,
): PlanLimit[] {
  if (!payload || typeof payload !== 'object') return []
  const value = payload as Record<string, unknown>
  const now = new Date().toISOString()
  if (provider === 'claude') {
    if (
      name !== 'rate_limit_event' ||
      !value.rate_limit_info ||
      typeof value.rate_limit_info !== 'object'
    )
      return []
    const info = value.rate_limit_info as Record<string, unknown>
    if (typeof info.utilization !== 'number' || !Number.isFinite(info.utilization)) return []
    const window =
      info.rateLimitType === 'five_hour'
        ? '5-hour'
        : info.rateLimitType === 'seven_day'
          ? '7-day'
          : info.rateLimitType === 'seven_day_opus'
            ? '7-day Opus'
            : info.rateLimitType === 'seven_day_sonnet'
              ? '7-day Sonnet'
              : undefined
    if (!window) return []
    return [
      {
        provider,
        window,
        usedPercent: Math.max(0, Math.min(100, info.utilization * 100)),
        resetsAt: typeof info.resetsAt === 'number' ? info.resetsAt : undefined,
        updatedAt: now,
      },
    ]
  }
  if (name !== 'account/rateLimits/updated' && name !== 'account/rateLimits/read') return []
  const limits =
    value.rateLimits && typeof value.rateLimits === 'object'
      ? (value.rateLimits as Record<string, unknown>)
      : value
  return (['primary', 'secondary'] as const).flatMap((key) => {
    const raw = limits[key]
    if (!raw || typeof raw !== 'object') return []
    const item = raw as Record<string, unknown>
    if (typeof item.usedPercent !== 'number' || !Number.isFinite(item.usedPercent)) return []
    const duration =
      typeof item.windowDurationMins === 'number' ? item.windowDurationMins : undefined
    const window = duration
      ? duration % 60 === 0
        ? `${duration / 60}-hour`
        : `${duration}-minute`
      : key === 'primary'
        ? 'Primary'
        : 'Secondary'
    return [
      {
        provider,
        window,
        usedPercent: Math.max(0, Math.min(100, item.usedPercent)),
        resetsAt: typeof item.resetsAt === 'number' ? item.resetsAt : undefined,
        updatedAt: now,
      },
    ]
  })
}

/** Quota observations are snapshots, never additive across computers. Unknown accounts stay separate. */
export function accountPlanLimits(
  sources: readonly { computer: string; sourceId?: string; limits: readonly PlanLimit[] }[],
  now = Date.now(),
) {
  const windows = new Map<
    string,
    PlanLimit & {
      key: string
      computers: string[]
      accountLabel: string
      accountKey: string
      sourceId?: string
    }
  >()
  for (const source of sources)
    for (const limit of source.limits) {
      if (
        !Number.isFinite(Date.parse(limit.updatedAt)) ||
        now - Date.parse(limit.updatedAt) > 30 * 86400000
      )
        continue
      const accountKey = limit.account?.id ?? `unknown:${source.sourceId ?? source.computer}`
      const key = JSON.stringify([limit.provider, accountKey, limit.window])
      const previous = windows.get(key)
      const computers = [...new Set([...(previous?.computers ?? []), source.computer])]
      const reading =
        previous && Date.parse(previous.updatedAt) > Date.parse(limit.updatedAt) ? previous : limit
      windows.set(key, {
        ...reading,
        key,
        accountKey,
        sourceId: reading === previous ? previous?.sourceId : source.sourceId,
        computers,
        accountLabel: limit.account
          ? `${limit.account.label}${limit.account.subscription ? ` · ${limit.account.subscription}` : ''}`
          : `Unidentified account · ${source.computer}`,
      })
    }
  return [...windows.values()].sort(
    (a, b) =>
      a.provider.localeCompare(b.provider) ||
      a.accountLabel.localeCompare(b.accountLabel) ||
      a.window.localeCompare(b.window),
  )
}
export function formatQuotaReset(resetsAt: number | undefined, now = Date.now()) {
  if (!resetsAt) return 'Reset time not reported'
  const ms = resetsAt * 1000 - now
  if (ms <= 0) return 'Reset time passed · awaiting a fresh reading'
  const minutes = Math.ceil(ms / 60000)
  const remaining =
    minutes < 60
      ? `${minutes}m`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
        : `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`
  return `Resets in ${remaining} · ${new Date(resetsAt * 1000).toLocaleString()}`
}

export function accountLimitGroups(windows: ReturnType<typeof accountPlanLimits>) {
  const groups = new Map<
    string,
    { key: string; label: string; provider: PlanLimit['provider']; windows: typeof windows }
  >()
  for (const window of windows) {
    const key = JSON.stringify([window.provider, window.accountKey])
    const group = groups.get(key) ?? {
      key,
      label: window.accountLabel,
      provider: window.provider,
      windows: [],
    }
    group.windows.push(window)
    groups.set(key, group)
  }
  for (const provider of ['codex', 'claude'] as const)
    if (![...groups.values()].some((group) => group.provider === provider))
      groups.set(provider, { key: provider, label: 'No account reading', provider, windows: [] })
  return [...groups.values()]
}

export const resetCreditsSchema = mutableStruct({
  supported: Schema.Boolean,
  pendingAttemptId: Schema.optional(Schema.String),
  availableCount: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  reason: Schema.optional(Schema.String),
  credits: mutableArray(
    mutableStruct({
      id: Schema.String,
      title: Schema.String,
      expiresAt: Schema.optional(Schema.String),
    }),
  ),
})
export const resetCreditResultSchema = mutableStruct({ outcome: Schema.String })
