import { runtimeRequest, RuntimeRequestError } from '../../shared/client.js'
import { snapshotSchema, type RuntimeSnapshot } from './runtime.js'
import type { RuntimeProfile } from './runtime-fleet.js'
import {
  fetchRuntimeReleases,
  runtimeUpdate,
  newerRuntimeVersion,
  type RuntimeReleases,
} from './runtime-releases.js'
import { serverUpdateStatusSchema, type ServerUpdateStatus } from './server-update.js'

export type RuntimeUpgradeEntry = {
  profile: RuntimeProfile
  snapshot: RuntimeSnapshot | null | undefined
  connected: boolean
  target?: 'desktop'
  sourceProfile?: RuntimeProfile
}
function desktopSnapshot(snapshot: RuntimeSnapshot): RuntimeSnapshot {
  return {
    ...snapshot,
    releaseVersion: snapshot.desktopApp?.version,
    releaseDistribution: 'desktop',
    releaseCanUpdate: snapshot.desktopApp?.canUpdate ?? false,
    // The desktop updater checks its own workspace before restarting; the server is independent.
    workspace: { ...snapshot.workspace, tasks: [] },
    runs: [],
  }
}
/** Expose a separate desktop target when connected through a standalone server on its host. */
export function runtimeUpgradeTargets(
  entries: readonly RuntimeUpgradeEntry[],
): RuntimeUpgradeEntry[] {
  const desktops = new Set(
    entries
      .filter((entry) => entry.snapshot?.releaseDistribution === 'desktop')
      .map((entry) => entry.snapshot?.runtimeHost)
      .filter(Boolean),
  )
  const result: RuntimeUpgradeEntry[] = []
  for (const entry of [...entries].sort((a, b) => Number(b.connected) - Number(a.connected))) {
    result.push(entry)
    const host = entry.snapshot?.runtimeHost
    if (
      !entry.snapshot?.desktopApp ||
      entry.snapshot.releaseDistribution === 'desktop' ||
      (host && desktops.has(host))
    )
      continue
    if (host) desktops.add(host)
    result.push({
      ...entry,
      target: 'desktop',
      sourceProfile: entry.profile,
      profile: { ...entry.profile, id: `${host ?? entry.profile.id}:desktop` },
      snapshot: desktopSnapshot(entry.snapshot),
    })
  }
  return result
}
export type RuntimeUpgradeState = {
  checking: boolean
  busy: readonly string[]
  selected: readonly string[]
  releases?: RuntimeReleases
  error?: string
  statuses: Readonly<Record<string, ServerUpdateStatus>>
}
export function runtimeUpgradeBlocked(entry: RuntimeUpgradeEntry, interruptDesktop = false) {
  if (!entry.connected) return 'Connect this computer to update it.'
  if (!entry.snapshot?.releaseVersion) return 'Update once on the host to enable remote updates.'
  if (!entry.snapshot.releaseCanUpdate)
    return entry.snapshot.releaseDistribution === 'desktop'
      ? 'Open a supported signed desktop app on the host to enable remote updates.'
      : 'Upgrade with the installer or package manager on the host.'
  if (
    !(interruptDesktop && entry.snapshot.releaseDistribution === 'desktop') &&
    (entry.snapshot.workspace.tasks.some((task) => task.status === 'running') ||
      entry.snapshot.runs.some((run) => run.status === 'running'))
  )
    return 'Finish running tasks and automations first.'
  return undefined
}
const inProgress = (status?: ServerUpdateStatus) =>
  !!status && ['queued', 'downloading', 'installing'].includes(status.status)

/** Batch dispatch is bounded; each host reports independent progress and failure. */
export function createRuntimeUpgradeManager(options: {
  entries: () => readonly RuntimeUpgradeEntry[]
  refreshed: (entry: RuntimeUpgradeEntry) => Promise<void>
}) {
  let state: RuntimeUpgradeState = { checking: false, busy: [], selected: [], statuses: {} }
  let polling = false
  const generations = new Map<string, number>()
  const unconfirmed = new Set<string>()
  const automaticRestarts = new Map<string, boolean>()
  const listeners = new Set<() => void>()
  const update = (next: Partial<RuntimeUpgradeState>) => {
    state = { ...state, ...next }
    listeners.forEach((listener) => listener())
  }
  const status = (id: string, next: ServerUpdateStatus) => {
    const previous = state.statuses[id]
    update({
      statuses: {
        ...state.statuses,
        [id]: {
          ...next,
          updatedAt:
            next.updatedAt ??
            (previous?.version === next.version && previous?.status === next.status
              ? previous?.updatedAt
              : undefined) ??
            new Date().toISOString(),
        },
      },
    })
  }
  const stalled = (id: string, previous: ServerUpdateStatus | undefined) => {
    if (
      inProgress(previous) &&
      previous?.updatedAt &&
      Date.now() - Date.parse(previous.updatedAt) > 15 * 60 * 1000
    )
      status(id, {
        ...previous,
        status: 'error',
        error:
          'The update has not reconnected. Reconnect this computer and verify its installed version.',
      })
  }
  const request = (
    entry: RuntimeUpgradeEntry,
    path: string,
    version?: string,
    resumeInterrupted?: boolean,
  ) =>
    runtimeRequest(
      entry.profile.connection,
      entry.profile.connection.address,
      `/api/runtime/${entry.target === 'desktop' ? 'desktop-update' : 'update'}/${path}`,
      version
        ? {
            version,
            ...(resumeInterrupted !== undefined && entry.snapshot?.releaseDistribution === 'desktop'
              ? { restartAfterDownload: path === 'start', resumeInterrupted }
              : {}),
          }
        : undefined,
      serverUpdateStatusSchema,
      version ? 'POST' : 'GET',
      5000,
    )
  const poll = async () => {
    if (polling) return
    polling = true
    try {
      await Promise.all(
        options
          .entries()
          .filter(
            (entry) =>
              inProgress(state.statuses[entry.profile.id]) ||
              (entry.connected &&
                (entry.snapshot?.releaseCanUpdate ||
                  (state.statuses[entry.profile.id]?.status === 'error' &&
                    !!state.statuses[entry.profile.id]?.version))),
          )
          .map(async (entry) => {
            if (state.busy.includes(entry.profile.id)) return
            const generation = generations.get(entry.profile.id)
            const previous = state.statuses[entry.profile.id]
            try {
              // Keep probing the saved connection during restart, even when fleet polling marks it offline.
              if (
                previous?.status === 'installing' ||
                (previous?.status === 'error' && previous.version)
              ) {
                const received = await runtimeRequest(
                  entry.profile.connection,
                  entry.profile.connection.address,
                  '/api/snapshot?overview=1',
                  undefined,
                  snapshotSchema,
                  'GET',
                  5000,
                )
                const snapshot = entry.target === 'desktop' ? desktopSnapshot(received) : received
                if (generations.get(entry.profile.id) !== generation) return
                if (
                  snapshot.releaseVersion &&
                  previous.version &&
                  (snapshot.releaseVersion === previous.version ||
                    newerRuntimeVersion(snapshot.releaseVersion, previous.version))
                ) {
                  unconfirmed.delete(entry.profile.id)
                  automaticRestarts.delete(entry.profile.id)
                  status(entry.profile.id, { status: 'complete', version: snapshot.releaseVersion })
                  await options.refreshed(entry)
                  return
                }
              }
              const next = await request(entry, 'status')
              if (generations.get(entry.profile.id) !== generation) return
              if (unconfirmed.has(entry.profile.id)) {
                unconfirmed.delete(entry.profile.id)
                if (next.version !== previous?.version || next.status === 'idle') {
                  status(entry.profile.id, {
                    status: 'error',
                    version: previous?.version,
                    error: 'The host did not accept the update request. Retry the update.',
                  })
                  return
                }
              }
              if (previous?.status === 'error' && next.status === 'idle') return
              // Preserve restart progress until the new app reports the requested version.
              if (previous?.status === 'installing' && next.status === 'idle') {
                stalled(entry.profile.id, previous)
                return
              }
              status(entry.profile.id, next)
              if (next.status === 'error' || next.status === 'complete')
                automaticRestarts.delete(entry.profile.id)
              stalled(entry.profile.id, state.statuses[entry.profile.id])
              if (next.status === 'complete' && previous?.status !== 'complete')
                await options.refreshed(entry)
            } catch {
              if (generations.get(entry.profile.id) !== generation) return
              stalled(entry.profile.id, previous)
              // Runtime fleet polling owns connection errors; updater progress survives disconnects.
            }
          }),
      )
      // Older desktop bridges only download; finish their explicitly requested restart here.
      if (!state.busy.length) {
        for (const [id, resumeInterrupted] of automaticRestarts) {
          const entry = options.entries().find((entry) => entry.profile.id === id)
          const status = state.statuses[id]
          if (
            !entry ||
            status?.status !== 'downloaded' ||
            status.error ||
            runtimeUpgradeBlocked(entry, true)
          )
            continue
          automaticRestarts.delete(id)
          await run([id], true, { restartDesktops: true, resumeInterrupted })
        }
      }
    } finally {
      polling = false
    }
  }
  const run = async (
    ids: readonly string[],
    restart = false,
    restartOptions?: { restartDesktops: boolean; resumeInterrupted: boolean },
  ) => {
    if (state.busy.length) return
    const targets = options.entries().filter((entry) => ids.includes(entry.profile.id))
    update({ busy: targets.map((entry) => entry.profile.id) })
    // Finish dispatching remote commands before restarting the local desktop controller.
    const ordered = [
      ...targets.filter((entry) => !entry.snapshot?.owner),
      ...targets.filter((entry) => entry.snapshot?.owner),
    ]
    try {
      if (!restart) update({ releases: await fetchRuntimeReleases(), error: undefined })
      for (const entry of ordered) {
        const id = entry.profile.id
        const release = runtimeUpdate(entry.snapshot, state.releases)
        const previous = state.statuses[id]
        const version = restart ? previous?.version : release.latest?.version
        const blocked = runtimeUpgradeBlocked(entry, restartOptions?.restartDesktops)
        if (
          blocked ||
          !version ||
          (restart
            ? entry.snapshot?.releaseDistribution !== 'desktop' || previous?.status !== 'downloaded'
            : !release.available || inProgress(previous) || previous?.status === 'downloaded')
        ) {
          status(id, { status: 'error', error: blocked ?? 'Check update availability again.' })
          continue
        }
        try {
          generations.set(id, (generations.get(id) ?? 0) + 1)
          unconfirmed.delete(id)
          if (
            !restart &&
            restartOptions?.restartDesktops &&
            entry.snapshot?.releaseDistribution === 'desktop'
          )
            automaticRestarts.set(id, restartOptions.resumeInterrupted)
          status(
            id,
            await request(
              entry,
              restart ? 'restart' : 'start',
              version,
              restartOptions?.restartDesktops ? restartOptions.resumeInterrupted : undefined,
            ),
          )
        } catch (cause) {
          if (
            cause instanceof RuntimeRequestError &&
            (cause.kind === 'connection' ||
              cause.kind === 'timeout' ||
              [502, 503, 504].includes(cause.status ?? 0))
          ) {
            // A mutation may already have reached the host. Probe reads; never resend it blindly.
            unconfirmed.add(id)
            status(id, { status: restart ? 'installing' : 'queued', version })
          } else {
            automaticRestarts.delete(id)
            status(id, {
              status: 'error',
              version,
              error: cause instanceof Error ? cause.message : String(cause),
            })
          }
        }
      }
    } catch (cause) {
      update({ error: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      update({ busy: [] })
    }
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    toggle(id: string) {
      update({
        selected: state.selected.includes(id)
          ? state.selected.filter((value) => value !== id)
          : [...state.selected, id],
      })
    },
    async check() {
      if (state.checking) return
      update({ checking: true, error: undefined })
      try {
        update({ releases: await fetchRuntimeReleases() })
        await poll()
      } catch (cause) {
        update({ error: cause instanceof Error ? cause.message : String(cause) })
      } finally {
        update({ checking: false })
      }
    },
    poll,
    start: (
      ids: readonly string[],
      restartOptions?: { restartDesktops: boolean; resumeInterrupted: boolean },
    ) => run(ids, false, restartOptions),
    restart: (ids: readonly string[]) => run(ids, true),
  }
}
