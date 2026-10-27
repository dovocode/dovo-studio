import type { RuntimeProfile } from './runtime-fleet.js'
import type { RuntimeConnection, RuntimeSnapshot } from './runtime.js'
import { sameRuntimeConnection } from '../cache/overview-state.js'
import { learnRuntimeRoutes } from './routes.js'

/** A saved computer and the pairing captured when an operation began. Route hints may evolve,
 * but replacing its address or credential invalidates the captured target. */
export type RuntimeTarget = Pick<RuntimeProfile, 'id' | 'connection'>

export function resolveRuntimeTarget(
  profiles: readonly RuntimeProfile[],
  target: RuntimeTarget,
): RuntimeProfile | undefined {
  return profiles.find(
    (profile) =>
      profile.id === target.id && sameRuntimeConnection(profile.connection, target.connection),
  )
}

/** Resource IDs are only unique within a saved computer. Keep the existing tuple encoding:
 * profile IDs may be HTTP origins, so delimiter-based concatenation is ambiguous. */
export function runtimeResourceKey(runtimeId: string, resourceId: string): string {
  return JSON.stringify([runtimeId, resourceId])
}

/** Updating an address preserves ownership, not just a display slot. Verify the authenticated
 * snapshot before transferring saved edits or confirming the replacement pairing. */
export function verifyRuntimeReplacement(
  previous: RuntimeConnection | null | undefined,
  candidate: RuntimeConnection,
  snapshot: RuntimeSnapshot,
): RuntimeConnection {
  if (previous?.runtimeId && previous.runtimeId !== snapshot.runtimeId)
    throw new Error(
      snapshot.runtimeId
        ? 'This is a different computer. Add it separately instead of replacing this connection.'
        : 'Could not verify this is the same computer. Update its runtime or add it separately.',
    )
  return learnRuntimeRoutes(candidate, snapshot)
}
