import { Schema } from 'effect'
import { mutableStruct, mutableArray } from '../../shared/schema.js'
export const usageAccountSchema = mutableStruct({
  id: Schema.String,
  label: Schema.String,
  subscription: Schema.optional(Schema.String),
})
export const planLimitSchema = mutableStruct({
  provider: Schema.Literals(['codex', 'claude']),
  account: Schema.optional(usageAccountSchema),
  sourceTaskId: Schema.optional(Schema.String),
  agentId: Schema.optional(Schema.String),
  bucketId: Schema.optional(Schema.String),
  windowId: Schema.optional(Schema.String),
  durationMins: Schema.optional(
    Schema.Number.pipe(Schema.check(Schema.isFinite()), Schema.check(Schema.isGreaterThan(0))),
  ),
  window: Schema.String,
  usedPercent: Schema.Number.pipe(Schema.check(Schema.isFinite())),
  resetsAt: Schema.optional(Schema.Number.pipe(Schema.check(Schema.isFinite()))),
  updatedAt: Schema.String,
})
export type PlanLimit = Schema.Schema.Type<typeof planLimitSchema>

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
  for (const incomingLimit of incoming) {
    let limit = incomingLimit
    if (limit.account)
      for (const [key, anonymous] of merged) {
        const sameSource = limit.sourceTaskId
          ? anonymous.sourceTaskId === limit.sourceTaskId
          : !!limit.agentId && anonymous.agentId === limit.agentId
        if (
          !anonymous.account &&
          anonymous.provider === limit.provider &&
          sameSource &&
          legacyWindow(anonymous) === legacyWindow(limit) &&
          (anonymous.bucketId ?? anonymous.provider) === (limit.bucketId ?? limit.provider)
        ) {
          // Learning an account identity must not roll a newer anonymous reading
          // back to an older probe. Attribute its observation to the known account.
          if (
            Number.isFinite(Date.parse(anonymous.updatedAt)) &&
            (!Number.isFinite(Date.parse(limit.updatedAt)) ||
              Date.parse(anonymous.updatedAt) > Date.parse(limit.updatedAt))
          )
            limit = { ...limit, ...anonymous, account: limit.account }
          merged.delete(key)
        }
      }
    const key = planLimitKey(limit)
    const old = merged.get(key)
    // A slow probe or delayed notification must not replace a newer observation.
    if (
      old &&
      Number.isFinite(Date.parse(old.updatedAt)) &&
      (!Number.isFinite(Date.parse(limit.updatedAt)) ||
        Date.parse(old.updatedAt) > Date.parse(limit.updatedAt))
    )
      continue
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
export function quotaReadingState(
  limit: PlanLimit & { readError?: boolean },
  connected: boolean,
  now = Date.now(),
) {
  if (!connected) return 'offline'
  if (limit.readError) return 'unavailable'
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
    readError?: boolean
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
      readError: boolean
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
        previous &&
        (Date.parse(previous.updatedAt) > Date.parse(limit.updatedAt) ||
          (previous.updatedAt === limit.updatedAt &&
            previous.connected &&
            !previous.readError &&
            (!source.connected || source.readError)))
          ? previous
          : limit
      windows.set(key, {
        ...reading,
        key,
        accountKey,
        sourceId: reading === previous ? previous?.sourceId : source.sourceId,
        computers,
        connected: reading === previous ? previous.connected : (source.connected ?? true),
        readError: reading === previous ? previous.readError : (source.readError ?? false),
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
  availableCount: Schema.Number.pipe(
    Schema.check(Schema.isInt()),
    Schema.check(Schema.isGreaterThanOrEqualTo(0)),
  ),
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

export const usageHubAccountSchema = mutableStruct({
  id: Schema.String,
  provider: Schema.Literals(['codex', 'claude']),
  account: usageAccountSchema,
  status: Schema.Literals(['ok', 'failed', 'unsupported']),
})
export type UsageHubAccount = Schema.Schema.Type<typeof usageHubAccountSchema>
export const usageHubSchema = mutableStruct({
  accounts: Schema.optional(mutableArray(usageHubAccountSchema)),
  id: Schema.String,
  label: Schema.String,
  url: Schema.String,
  enabled: Schema.Boolean,
  checkedAt: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  limits: mutableArray(planLimitSchema),
})
export type UsageHub = Schema.Schema.Type<typeof usageHubSchema>
export const usageHubsSchema = mutableArray(usageHubSchema)
export const usageHubInputSchema = mutableStruct({
  id: Schema.optional(
    Schema.String.pipe(Schema.check(Schema.isMinLength(1)), Schema.check(Schema.isMaxLength(100))),
  ),
  label: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(100)),
  ),
  url: Schema.String.pipe(Schema.check(Schema.isMaxLength(2000))),
  enabled: Schema.Boolean,
  managementKey: Schema.optional(
    Schema.String.pipe(
      Schema.check(Schema.isMinLength(1)),
      Schema.check(Schema.isMaxLength(10000)),
    ),
  ),
})
export type UsageHubInput = Schema.Schema.Type<typeof usageHubInputSchema>

export const usageLimitsReadSchema = mutableStruct({
  hubs: Schema.optional(usageHubsSchema),
  checkedAt: Schema.String,
  accounts: mutableArray(
    mutableStruct({
      agentId: Schema.String,
      provider: Schema.String,
      status: Schema.Literals(['ok', 'unsupported', 'failed']),
      reason: Schema.optional(Schema.String),
    }),
  ),
})

/** One equally sized segment per account, never a sum of different subscription capacities. */
export function pooledPlanLimits(
  windows: ReturnType<typeof accountPlanLimits>,
  now = Date.now(),
  knownAccounts: readonly UsageHubAccount[] = [],
) {
  const accounts = new Map<string, typeof windows>()
  for (const window of windows) {
    const key = JSON.stringify([window.provider, window.bucketId ?? window.provider])
    const group = accounts.get(key) ?? []
    group.push(window)
    accounts.set(key, group)
  }
  return [...accounts].flatMap(([bucket, readings]) => {
    const byAccount = new Map<
      string,
      {
        label: string
        windows: Map<string, (typeof readings)[number]>
        weekly?: (typeof readings)[number]
      }
    >()
    for (const row of readings) {
      const account = byAccount.get(row.accountKey) ?? {
        label: row.accountLabel,
        windows: new Map<string, typeof row>(),
      }
      account.windows.set(row.windowId ?? row.window, row)
      if (row.window === 'Weekly') account.weekly = row
      byAccount.set(row.accountKey, account)
    }
    for (const account of knownAccounts) {
      if (
        account.status === 'unsupported' ||
        JSON.stringify([account.provider, account.provider]) !== bucket ||
        byAccount.has(account.account.id)
      )
        continue
      byAccount.set(account.account.id, { label: account.account.label, windows: new Map() })
    }
    const identities = [...byAccount.keys()].sort()
    const definitions = new Map(readings.map((row) => [row.windowId ?? row.window, row]))
    return [...definitions].map(([windowId, definition]) => {
      const segments = identities.map((accountKey) => {
        const own = byAccount.get(accountKey)!
        const reading = own.windows.get(windowId)
        const weekly = own.weekly
        const session = definition.window === 'Session'
        const gate =
          session &&
          weekly &&
          quotaReadingState(weekly, weekly.connected, now) === 'fresh' &&
          weekly.usedPercent >= 100
            ? weekly
            : undefined
        const readingState = reading
          ? quotaReadingState(reading, reading.connected, now)
          : 'unknown'
        const state =
          session &&
          weekly &&
          quotaReadingState(weekly, weekly.connected, now) !== 'fresh' &&
          readingState === 'fresh'
            ? 'unknown'
            : readingState
        const remaining =
          state === 'fresh' && reading
            ? gate
              ? 0
              : Math.max(0, Math.min(100, 100 - reading.usedPercent))
            : null
        return {
          accountKey,
          label: own.label,
          state,
          remaining,
          gatedByWeekly: !!gate,
          resetsAt:
            gate && reading && reading.usedPercent >= 100
              ? gate.resetsAt && reading.resetsAt
                ? Math.max(gate.resetsAt, reading.resetsAt)
                : undefined
              : (gate?.resetsAt ?? reading?.resetsAt),
        }
      })
      const resets = segments.flatMap((segment) =>
        segment.remaining === 0 && segment.resetsAt && segment.resetsAt * 1000 > now
          ? [segment.resetsAt]
          : [],
      )
      return {
        key: JSON.stringify([bucket, windowId]),
        provider: definition.provider,
        window: definition.window,
        segments,
        available: segments.filter((segment) => segment.remaining !== null && segment.remaining > 0)
          .length,
        unknown: segments.filter((segment) => segment.remaining === null).length,
        nextReset: resets.length ? Math.min(...resets) : undefined,
      }
    })
  })
}

/** Per-account health prevents one failed auth file from disabling healthy accounts. */
export function hubPlanLimitSources(
  hub: UsageHub,
  source: { computer: string; sourceId: string; connected: boolean },
) {
  if (!hub.accounts)
    return [{ ...source, connected: source.connected && !hub.error, limits: hub.limits }]
  const status = new Map<string, boolean>()
  for (const account of hub.accounts)
    status.set(
      account.account.id,
      (status.get(account.account.id) ?? false) || account.status === 'ok',
    )
  const grouped = new Map<string, PlanLimit[]>()
  for (const limit of hub.limits) {
    const id = limit.account?.id ?? ''
    const limits = grouped.get(id) ?? []
    limits.push(limit)
    grouped.set(id, limits)
  }
  return [...grouped].map(([id, limits]) => ({
    ...source,
    readError: status.get(id) !== true,
    limits,
  }))
}
