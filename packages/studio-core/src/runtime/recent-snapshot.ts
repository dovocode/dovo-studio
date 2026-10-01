import type { RuntimeOverview, RuntimeProfile } from '@dovo/protocol'

/** Reuse only a recent successful read of the exact saved credentials and address. */
export function recentSnapshot(
  profile: RuntimeProfile,
  overview: RuntimeOverview | undefined,
  now = Date.now(),
) {
  if (!overview?.connected || !overview.snapshot || !overview.lastSeen) return null
  if (
    overview.profile.connection.address !== profile.connection.address ||
    overview.profile.connection.token !== profile.connection.token
  )
    return null
  const age = now - Date.parse(overview.lastSeen)
  return age >= 0 && age < 15_000 ? overview.snapshot : null
}
