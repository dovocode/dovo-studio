import { retainWorkspace } from './retain-workspace.js'
import { getRuntimeSnapshotTag, copyRuntimeSnapshotTag } from '../../shared/client.js'
import type { RuntimeOverview } from '../connection/runtime-fleet.js'
import type { RuntimeConnection, RuntimeSnapshot } from '../connection/runtime.js'
const ownedSnapshots = new WeakMap<RuntimeSnapshot, RuntimeSnapshot>()

/** Older runtimes and saved caches can include foreign thread projections. Keep their
 * original records intact, but never install them as this computer's workspace. */
export function ownedRuntimeSnapshot(snapshot: RuntimeSnapshot): RuntimeSnapshot {
  const cached = ownedSnapshots.get(snapshot)
  if (cached) return cached
  const tasks = snapshot.workspace.tasks.filter((task) => !task.replica)
  const page = snapshot.olderSettled
  const keys = page?.threadKeys?.filter((key) => {
    if (!snapshot.runtimeId) return true
    try {
      const identity: unknown = JSON.parse(key)
      return Array.isArray(identity) && identity.length === 2 && identity[0] === snapshot.runtimeId
    } catch {
      return false
    }
  })
  const pageChanged = keys && keys.length !== page?.threadKeys?.length
  if (tasks.length === snapshot.workspace.tasks.length && !pageChanged) return snapshot
  const replicaIds = new Set(
    snapshot.workspace.tasks.filter((task) => task.replica).map((task) => task.id),
  )
  const owned = {
    ...snapshot,
    workspace: { ...snapshot.workspace, tasks },
    ...(page && pageChanged
      ? { olderSettled: { ...page, threadKeys: keys, omitted: keys.length } }
      : {}),
    ...(snapshot.detailTaskIds
      ? { detailTaskIds: snapshot.detailTaskIds.filter((id) => !replicaIds.has(id)) }
      : {}),
  }
  copyRuntimeSnapshotTag(snapshot, owned)
  ownedSnapshots.set(snapshot, owned)
  return owned
}
export function sameRuntimeConnection(
  previous: RuntimeConnection | null | undefined,
  next: RuntimeConnection | null | undefined,
) {
  return !!previous && !!next && previous.address === next.address && previous.token === next.token
}

export function retainRuntimeSnapshot(
  previous: RuntimeSnapshot | null,
  previousConnection: RuntimeConnection | null,
  next: RuntimeSnapshot | null,
  nextConnection: RuntimeConnection | null,
): RuntimeSnapshot | null {
  previous = previous && ownedRuntimeSnapshot(previous)
  next = next && ownedRuntimeSnapshot(next)
  if (!previous || !next || !sameRuntimeConnection(previousConnection, nextConnection)) return next
  // Revisions restart with the process; compare them only within the same instance.
  if (
    previous.runtimeInstanceId &&
    previous.runtimeInstanceId === next.runtimeInstanceId &&
    next.revision < previous.revision
  )
    return previous
  const tag = getRuntimeSnapshotTag(next)
  const previousTag = getRuntimeSnapshotTag(previous)
  if (!tag || !previousTag) return next
  if (tag === previousTag) return previous
  const workspace = retainWorkspace(previous.workspace, next.workspace)
  if (workspace === next.workspace) return next
  const retained = { ...next, workspace }
  copyRuntimeSnapshotTag(next, retained)
  return retained
}

export function retainOverviewSnapshot(
  previous: RuntimeOverview | undefined,
  next: RuntimeOverview,
) {
  const snapshot = retainRuntimeSnapshot(
    previous?.snapshot ?? null,
    previous?.profile.connection ?? null,
    next.snapshot,
    next.profile.connection,
  )
  return snapshot === next.snapshot ? next : { ...next, snapshot }
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
    previous.unauthorized !== next.unauthorized ||
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
