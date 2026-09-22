import { getRuntimeSnapshotTag, type RuntimeOverview } from '@dovo/protocol'

export function retainOverviewSnapshot(previous: RuntimeOverview, next: RuntimeOverview) {
  const tag = next.snapshot && getRuntimeSnapshotTag(next.snapshot)
  if (
    previous.profile.id === next.profile.id &&
    previous.profile.connection.token === next.profile.connection.token &&
    previous.snapshot &&
    tag &&
    tag === getRuntimeSnapshotTag(previous.snapshot)
  )
    return { ...next, snapshot: previous.snapshot }
  return next
}

export function shouldPublishOverview(
  previous: RuntimeOverview | undefined,
  next: RuntimeOverview,
) {
  if (
    !previous ||
    previous.profile !== next.profile ||
    previous.snapshot !== next.snapshot ||
    previous.connected !== next.connected ||
    previous.error !== next.error ||
    previous.pullError !== next.pullError ||
    previous.pulls?.total !== next.pulls?.total ||
    previous.pulls?.needsAttention !== next.pulls?.needsAttention ||
    previous.pulls?.reviewRequested !== next.pulls?.reviewRequested ||
    previous.pulls?.partial !== next.pulls?.partial
  )
    return true
  if (previous.lastSeen === next.lastSeen) return false
  if (!next.connected || !previous.lastSeen || !next.lastSeen) return true
  // Keep the UI fresh without making every successful idle poll rebuild the view.
  // The provider separately retains the exact timestamp for failures and disk writes.
  const elapsed = Date.parse(next.lastSeen) - Date.parse(previous.lastSeen)
  return !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= 30000
}
