import type { RuntimeOverview } from './runtime-fleet.js'

/** Describe observed state only: a saved snapshot does not prove current access. */
export function connectionProgress(
  entry: Pick<RuntimeOverview, 'connected' | 'unauthorized' | 'error' | 'snapshot'>,
  recovering = false,
) {
  const labels = ['Find computer', 'Request access', 'Connect', 'Ready']
  const current = entry.connected
    ? 3
    : recovering || entry.unauthorized
      ? 1
      : entry.snapshot
        ? 2
        : 0
  return labels.map((label, index) => ({
    label,
    state:
      index === current
        ? entry.connected
          ? 'done'
          : recovering
            ? 'current'
            : entry.error || entry.unauthorized
              ? 'failed'
              : 'current'
        : index < current && (index !== 1 || entry.connected)
          ? 'done'
          : 'pending',
  }))
}
