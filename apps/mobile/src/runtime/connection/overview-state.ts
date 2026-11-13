import {
  retainOverviewSnapshot as retainOverview,
  retainCachedThreads,
  sameRuntimeConnection,
  type RuntimeOverview,
} from '@dovo/protocol'

export { shouldPublishOverview } from '@dovo/protocol'

/** Keep recent conversations available before the periodic offline writer runs. */
export function retainOverviewSnapshot(
  previous: RuntimeOverview | undefined,
  next: RuntimeOverview,
): RuntimeOverview {
  if (
    !previous?.snapshot ||
    !next.snapshot ||
    previous.snapshot === next.snapshot ||
    !sameRuntimeConnection(previous.profile.connection, next.profile.connection) ||
    previous.snapshot.runtimeId !== next.snapshot.runtimeId ||
    previous.snapshot.runtimeInstanceId !== next.snapshot.runtimeInstanceId
  )
    return retainOverview(previous, next)
  const snapshot = retainCachedThreads(previous.snapshot, next.snapshot)
  // Restore history before comparing entities, so idle rows keep their identity during streaming.
  return retainOverview(previous, snapshot === next.snapshot ? next : { ...next, snapshot })
}
