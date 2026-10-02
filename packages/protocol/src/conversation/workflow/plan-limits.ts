import { Schema } from 'effect'
import { mutableStruct, mutableArray } from '../../shared/schema.js'
export interface PlanLimit {
  provider: 'codex' | 'claude'
  sourceTaskId?: string
  agentId?: string
  bucketId?: string
  windowId?: string
  durationMins?: number
  account?: { id: string; label: string; subscription?: string }
  window: string
  usedPercent: number
  resetsAt?: number
  updatedAt: string
}

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
export function limitWindowLabel(minutes: number | undefined, fallback: string) {
  if (minutes === 300) return 'Session'
  if (minutes === 10080) return 'Weekly'
  if (minutes && minutes >= 40320 && minutes <= 44640) return 'Monthly'
  if (!minutes) return fallback
  return minutes % 1440 === 0
    ? `${minutes / 1440}-day`
    : minutes % 60 === 0
      ? `${minutes / 60}-hour`
      : `${minutes}-minute`
}

/** Keep stable bucket/window identities independent of labels and sparse event fields. */
export function reportedPlanLimits(
  provider: PlanLimit['provider'],
  name: string,
  payload: unknown,
): PlanLimit[] {
  const value = record(payload)
  const updatedAt = new Date().toISOString()
  if (provider === 'claude') {
    if (name === 'account/usage/read') {
      const windows = record(value.rate_limits ?? payload)
      const rows = Object.entries(windows).flatMap(([key, raw]) => {
        const item = record(raw)
        if (!finite(item.utilization)) return []
        const resetsAt =
          typeof item.resets_at === 'string' ? Date.parse(item.resets_at) / 1000 : undefined
        return [
          {
            provider,
            bucketId: 'claude',
            windowId: key,
            window:
              key === 'five_hour'
                ? 'Session'
                : key === 'seven_day'
                  ? 'Weekly'
                  : key.replaceAll('_', ' '),
            ...(key === 'five_hour'
              ? { durationMins: 300 }
              : key.startsWith('seven_day')
                ? { durationMins: 10080 }
                : {}),
            usedPercent: Math.max(0, Math.min(100, item.utilization)),
            ...(resetsAt !== undefined && finite(resetsAt) ? { resetsAt } : {}),
            updatedAt,
          },
        ]
      })
      if (Array.isArray(windows.model_scoped))
        for (const raw of windows.model_scoped) {
          const item = record(raw)
          if (typeof item.display_name !== 'string' || !finite(item.utilization)) continue
          const resetsAt =
            typeof item.resets_at === 'string' ? Date.parse(item.resets_at) / 1000 : undefined
          rows.push({
            provider,
            bucketId: 'claude',
            windowId: `model:${item.display_name}`,
            window: `Weekly · ${item.display_name}`,
            durationMins: 10080,
            usedPercent: Math.max(0, Math.min(100, item.utilization)),
            ...(resetsAt !== undefined && finite(resetsAt) ? { resetsAt } : {}),
            updatedAt,
          })
        }
      return rows
    }
    if (name !== 'rate_limit_event') return []
    const info = record(value.rate_limit_info)
    if (!finite(info.utilization) || typeof info.rateLimitType !== 'string') return []
    const key = info.rateLimitType
    if (!key.startsWith('seven_day') && key !== 'five_hour') return []
    return [
      {
        provider,
        bucketId: 'claude',
        windowId: key,
        window:
          key === 'five_hour'
            ? 'Session'
            : key === 'seven_day'
              ? 'Weekly'
              : key.replaceAll('_', ' '),
        durationMins: key === 'five_hour' ? 300 : 10080,
        usedPercent: Math.max(0, Math.min(100, info.utilization * 100)),
        ...(finite(info.resetsAt) ? { resetsAt: info.resetsAt } : {}),
        updatedAt,
      },
    ]
  }
  if (name !== 'account/rateLimits/updated' && name !== 'account/rateLimits/read') return []
  const named = record(value.rateLimitsByLimitId)
  const buckets = Object.keys(named).length
    ? Object.entries(named)
    : ([[undefined, value.rateLimits ?? value]] as const)
  return buckets.flatMap(([id, raw]) => {
    const limits = record(raw)
    const bucketId = typeof limits.limitId === 'string' ? limits.limitId : (id ?? 'codex')
    const bucketName = typeof limits.limitName === 'string' ? limits.limitName : bucketId
    return (['primary', 'secondary'] as const).flatMap((windowId) => {
      const item = record(limits[windowId])
      if (!finite(item.usedPercent)) return []
      const durationMins =
        finite(item.windowDurationMins) && item.windowDurationMins > 0
          ? item.windowDurationMins
          : undefined
      const label = limitWindowLabel(durationMins, windowId === 'primary' ? 'Primary' : 'Secondary')
      return [
        {
          provider,
          bucketId,
          windowId,
          ...(durationMins ? { durationMins } : {}),
          window: bucketId === 'codex' ? label : `${bucketName} · ${label}`,
          usedPercent: Math.max(0, Math.min(100, item.usedPercent)),
          ...(finite(item.resetsAt) ? { resetsAt: item.resetsAt } : {}),
          updatedAt,
        },
      ]
    })
  })
}
const legacyWindow = (limit: PlanLimit) =>
  limit.windowId ??
  (limit.provider === 'codex'
    ? ['Session', '5-hour', 'Primary'].includes(limit.window)
      ? 'primary'
      : ['Weekly', '7-day', '168-hour', 'Secondary'].includes(limit.window)
        ? 'secondary'
        : limit.window
    : ['Session', '5-hour'].includes(limit.window)
      ? 'five_hour'
      : ['Weekly', '7-day'].includes(limit.window)
        ? 'seven_day'
        : limit.window)
export function planLimitKey(limit: PlanLimit, sourceId = '') {
  return JSON.stringify([
    limit.provider,
    limit.account?.id ?? `unknown:${sourceId}:${limit.agentId ?? limit.sourceTaskId ?? ''}`,
    limit.bucketId ?? limit.provider,
    legacyWindow(limit),
  ])
}
/** Notifications are sparse: preserve known reset times and durations unless supplied. */
export function mergePlanLimits(
  previous: readonly PlanLimit[],
  incoming: readonly PlanLimit[],
): PlanLimit[] {
  const merged = new Map(previous.map((limit) => [planLimitKey(limit), limit]))
  for (const limit of incoming) {
    if (limit.account)
      for (const [key, old] of merged) {
        const sameSource = limit.sourceTaskId
          ? old.sourceTaskId === limit.sourceTaskId
          : !!limit.agentId && old.agentId === limit.agentId
        if (
          !old.account &&
          old.provider === limit.provider &&
          sameSource &&
          legacyWindow(old) === legacyWindow(limit) &&
          (old.bucketId ?? old.provider) === (limit.bucketId ?? limit.provider)
        )
          merged.delete(key)
      }
    const key = planLimitKey(limit)
    const old = merged.get(key)
    const durationMins = limit.durationMins ?? old?.durationMins
    merged.set(key, {
      ...old,
      ...limit,
      ...(durationMins ? { durationMins } : {}),
      ...(limit.resetsAt !== undefined || old?.resetsAt !== undefined
        ? { resetsAt: limit.resetsAt ?? old?.resetsAt }
        : {}),
      window: !limit.durationMins && old?.durationMins ? old.window : limit.window,
    })
  }
  return [...merged.values()]
}
export function quotaReadingState(limit: PlanLimit, connected: boolean, now = Date.now()) {
  if (!connected) return 'offline'
  if (!Number.isFinite(Date.parse(limit.updatedAt))) return 'stale'
  if (limit.resetsAt && limit.resetsAt * 1000 <= now) return 'awaiting'
  return now - Date.parse(limit.updatedAt) > 5 * 60_000 ? 'stale' : 'fresh'
}

/** Quota observations are snapshots, never additive across computers. Unknown accounts stay separate. */
export function accountPlanLimits(
  sources: readonly {
    computer: string
    sourceId?: string
    connected?: boolean
    limits: readonly PlanLimit[]
  }[],
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
      connected: boolean
    }
  >()
  for (const source of sources)
    for (const limit of source.limits) {
      if (
        !Number.isFinite(Date.parse(limit.updatedAt)) ||
        now - Date.parse(limit.updatedAt) > 30 * 86400000
      )
        continue
      const accountKey =
        limit.account?.id ??
        `unknown:${source.sourceId ?? source.computer}:${limit.agentId ?? limit.sourceTaskId ?? ''}`
      const key = planLimitKey(limit, source.sourceId ?? source.computer)
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
        connected: (previous?.connected ?? false) || (source.connected ?? true),
        accountLabel: limit.account
          ? `${limit.account.label}${limit.account.subscription ? ` · ${limit.account.subscription}` : ''}`
          : `Unidentified account · ${source.computer}`,
      })
    }
  return [...windows.values()].sort(
    (a, b) =>
      a.provider.localeCompare(b.provider) ||
      a.accountLabel.localeCompare(b.accountLabel) ||
      (a.durationMins ?? (a.window.includes('hour') ? 300 : 10080)) -
        (b.durationMins ?? (b.window.includes('hour') ? 300 : 10080)) ||
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

export const usageLimitsReadSchema = mutableStruct({
  checkedAt: Schema.String,
  accounts: mutableArray(
    mutableStruct({
      agentId: Schema.String,
      provider: Schema.String,
      status: Schema.Literal('ok', 'unsupported', 'failed'),
      reason: Schema.optional(Schema.String),
    }),
  ),
})

/** Account allowance is distinct from the composer's context-window meter. */
export function composerPlanLimit(
  task: { turns?: readonly { provider: string; usageAccount?: { id: string } }[] },
  limits: readonly PlanLimit[],
  connected: boolean,
  now = Date.now(),
) {
  const turn = task.turns?.at(-1)
  if (!turn?.usageAccount) return undefined
  const windows = limits.filter(
    (limit) =>
      limit.provider === turn.provider &&
      limit.account?.id === turn.usageAccount?.id &&
      (!limit.bucketId || limit.bucketId === limit.provider),
  )
  const fresh = windows.filter((limit) => quotaReadingState(limit, connected, now) === 'fresh')
  const limit = [...(fresh.length ? fresh : windows)].sort(
    (a, b) => b.usedPercent - a.usedPercent,
  )[0]
  if (!limit) return undefined
  const state = quotaReadingState(limit, connected, now)
  const remaining = Math.round(Math.max(0, Math.min(100, 100 - limit.usedPercent)))
  return {
    limit,
    state,
    remaining,
    label:
      state === 'fresh'
        ? `${limit.window}: ${remaining}% allowance left`
        : `${limit.window}: ${state === 'awaiting' ? 'awaiting a fresh reading' : state + ' reading'}`,
  }
}
