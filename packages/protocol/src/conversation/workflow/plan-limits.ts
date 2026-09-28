export interface PlanLimit {
  provider: 'codex' | 'claude'
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
