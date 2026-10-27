import {
  resolveRuntimeTarget,
  sameRuntimeConnection,
  type RuntimeConnection,
  type RuntimeOverview,
  type RuntimeProfile,
  type RuntimeSnapshot,
  type RuntimeTarget,
} from '@dovo/protocol'
import {
  previewWorkspace,
  taskPreviewConfirmed,
  type TaskPreview,
} from '../workspace/task-previews'

export const idleRuntimeOverview = (
  profile: RuntimeProfile,
  snapshot: RuntimeSnapshot | null = null,
): RuntimeOverview => ({
  profile,
  snapshot,
  connected: false,
  lastSeen: null,
  error: null,
  pulls: null,
  pullError: null,
})

/** A cached view belongs to the address and credential that read it. Learned routes may differ,
 * so a current view is relabelled with the saved profile that requests must use. */
export function currentRuntimeOverview(
  profile: RuntimeProfile,
  overview: RuntimeOverview | undefined,
) {
  if (!overview || !resolveRuntimeTarget([profile], overview.profile)) return undefined
  return overview.profile === profile ? overview : { ...overview, profile }
}

/** The connection an address replacement must match. Prefer the identity saved for the profile:
 * the open connection predates routes learned into it. Before that is persisted, use the identity
 * reported by a snapshot the old pairing read. A pairing that never reported one stays compatible. */
export function replacedRuntimeConnection(
  open: RuntimeConnection | null | undefined,
  saved: RuntimeConnection | undefined,
  observed?: RuntimeOverview,
): RuntimeConnection | undefined {
  const previous = open ?? saved
  if (!previous) return undefined
  const read =
    observed && sameRuntimeConnection(observed.profile.connection, previous)
      ? observed.snapshot?.runtimeId
      : undefined
  const runtimeId = saved?.runtimeId ?? previous.runtimeId ?? read
  return runtimeId && runtimeId !== previous.runtimeId ? { ...previous, runtimeId } : previous
}

/** Each saved computer with the view read through its current pairing, plus that pairing's
 * unconfirmed task edits. A replaced address or credential shows no cached view until read. */
export function visibleRuntimeOverviews(
  profiles: readonly RuntimeProfile[],
  overviews: Readonly<Record<string, RuntimeOverview>>,
  previews: readonly TaskPreview[],
): RuntimeOverview[] {
  return profiles.map((profile) => {
    const entry =
      currentRuntimeOverview(profile, overviews[profile.id]) ?? idleRuntimeOverview(profile)
    const snapshot = entry.snapshot
    if (!snapshot) return entry
    const workspace = previewWorkspace(
      snapshot.workspace,
      profile.connection,
      previews.filter((item) => !taskPreviewConfirmed(item, snapshot, previews)),
    )
    return workspace === snapshot.workspace
      ? entry
      : { ...entry, snapshot: { ...snapshot, workspace } }
  })
}

/** Live workspace state describes this entry only while it is the open connection. */
export const isActiveRuntime = (
  target: RuntimeTarget,
  activeRuntimeId: string | null,
  connection: RuntimeConnection | null,
) => target.id === activeRuntimeId && sameRuntimeConnection(target.connection, connection)
