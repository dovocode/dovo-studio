import type { DoItemStatus, DoPlanItem, DoRunStatus, RuntimeOverview } from '@dovo/protocol'

export const runStatusLabels: Record<DoRunStatus, string> = {
  draft: 'Saved draft',
  running: 'Running',
  attention: 'Needs attention',
  cancelling: 'Stopping work',
  cancelled: 'Cancelled',
  review: 'Ready for your review',
  completed: 'Reviewed',
}
export const itemStatusLabels: Record<DoItemStatus, string> = {
  pending: 'Waiting to start',
  dispatching: 'Starting',
  running: 'Working',
  waiting: 'Needs your response',
  blocked: 'Blocked',
  completed: 'Finished',
  failed: 'Failed',
  cancelling: 'Stopping',
  cancelled: 'Cancelled',
}

/** Local means the plan's home computer. Remote IDs are scoped to its Studio pairing registry. */
export function doThreadOwner(
  entries: readonly RuntimeOverview[],
  originProfileId: string,
  targetRuntimeId: string,
) {
  if (targetRuntimeId === 'local')
    return entries.find((entry) => entry.profile.id === originProfileId)
  return (
    entries.find(
      (entry) =>
        (entry.snapshot?.runtimeId ?? entry.profile.connection.runtimeId) === targetRuntimeId,
    ) ??
    entries.find(
      (entry) =>
        entry.profile.id === targetRuntimeId ||
        entry.profile.connection.address === targetRuntimeId,
    )
  )
}

export function withoutDoItem(items: readonly DoPlanItem[], id: string): DoPlanItem[] {
  return items
    .filter((item) => item.id !== id)
    .map((item) => ({
      ...item,
      dependsOn: item.dependsOn.filter((dependency) => dependency !== id),
    }))
}
