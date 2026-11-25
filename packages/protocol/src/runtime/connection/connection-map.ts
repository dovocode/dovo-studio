import { runtimeComputerName, runtimeReachability, type RuntimeOverview } from './runtime-fleet.js'
import { runtimeRouteLabel, selectedRuntimeRoute } from './routes.js'
import { activeRuntimeStreamRoute } from './live-sync.js'

export function runtimeConnectionMap(entries: readonly RuntimeOverview[]) {
  const paired = new Map(
    entries.flatMap((entry) => {
      const identity = entry.profile.connection.runtimeId ?? entry.snapshot?.runtimeId
      return identity ? [[identity, runtimeComputerName(entry)] as const] : []
    }),
  )
  return entries.map((entry) => {
    const connection = entry.profile.connection
    const identity = connection.runtimeId ?? entry.snapshot?.runtimeId
    const links = new Map<
      string,
      { name: string; paired: boolean; threads: Set<string>; reachable: boolean }
    >()
    for (const task of entry.snapshot?.workspace.tasks ?? []) {
      if (task.archived || task.archivedAt || task.replica) continue
      for (const watch of task.threadWatches ?? []) {
        const owner = watch.snapshot?.runtimeId
        if (
          !owner ||
          owner === identity ||
          watch.runtimeId === 'local' ||
          watch.status === 'stopped'
        )
          continue
        const directName = paired.get(owner)
        const existing = links.get(owner)
        links.set(owner, {
          name: directName ?? existing?.name ?? watch.computerName,
          paired: directName !== undefined,
          threads: (existing?.threads ?? new Set<string>()).add(watch.threadId),
          reachable:
            !!existing?.reachable ||
            (entry.connected && !!watch.lastSuccessAt && !watch.offline && !watch.paused),
        })
      }
    }
    const stream = entry.connected ? activeRuntimeStreamRoute(connection) : undefined
    return {
      profileId: entry.profile.id,
      name: runtimeComputerName(entry),
      status: entry.unauthorized ? ('pairing expired' as const) : runtimeReachability(entry),
      http: runtimeRouteLabel(selectedRuntimeRoute(connection)),
      live: stream && runtimeRouteLabel(stream),
      links: [...links.entries()].map(([id, { threads, ...link }]) => ({
        id,
        ...link,
        count: threads.size,
      })),
    }
  })
}
