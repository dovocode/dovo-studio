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
}
export type RuntimeUpgradeState = {
  checking: boolean
  busy: readonly string[]
  selected: readonly string[]
  releases?: RuntimeReleases
  error?: string
  statuses: Readonly<Record<string, ServerUpdateStatus>>
}
export function runtimeUpgradeBlocked(entry: RuntimeUpgradeEntry) {
  if (!entry.connected) return 'Connect this computer to update it.'
  if (!entry.snapshot?.releaseVersion) return 'Update once on the host to enable remote updates.'
  if (!entry.snapshot.releaseCanUpdate)
    return entry.snapshot.releaseDistribution === 'desktop'
      ? 'Open a supported signed desktop app on the host to enable remote updates.'
      : 'Upgrade with the installer or package manager on the host.'
  if (
    entry.snapshot.workspace.tasks.some((task) => task.status === 'running') ||
    entry.snapshot.runs.some((run) => run.status === 'running')
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
  const request = (entry: RuntimeUpgradeEntry, path: string, version?: string) =>
    runtimeRequest(
      entry.profile.connection,
      entry.profile.connection.address,
      `/api/runtime/update/${path}`,
      version ? { version } : undefined,
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
                const snapshot = await runtimeRequest(
                  entry.profile.connection,
                  entry.profile.connection.address,
                  '/api/snapshot?overview=1',
                  undefined,
                  snapshotSchema,
                  'GET',
                  5000,
                )
                if (generations.get(entry.profile.id) !== generation) return
                if (
                  snapshot.releaseVersion &&
                  previous.version &&
                  (snapshot.releaseVersion === previous.version ||
                    newerRuntimeVersion(snapshot.releaseVersion, previous.version))
                ) {
                  unconfirmed.delete(entry.profile.id)
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
    } finally {
      polling = false
    }
  }
  const run = async (ids: readonly string[], restart = false) => {
    if (state.busy.length) return
    const targets = options.entries().filter((entry) => ids.includes(entry.profile.id))
    update({ busy: targets.map((entry) => entry.profile.id) })
    // Finish dispatching remote commands before restarting the local desktop controller.
    const ordered = [
      ...targets.filter((entry) => !entry.snapshot?.owner),
      ...targets.filter((entry) => entry.snapshot?.owner),
    ]
    try {
      for (const entry of ordered) {
        const id = entry.profile.id
        const release = runtimeUpdate(entry.snapshot, state.releases)
        const previous = state.statuses[id]
        const version = restart ? previous?.version : release.latest?.version
        const blocked = runtimeUpgradeBlocked(entry)
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
          status(id, await request(entry, restart ? 'restart' : 'start', version))
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
            status(id, {
              status: 'error',
              version,
              error: cause instanceof Error ? cause.message : String(cause),
            })
          }
        }
      }
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
    start: (ids: readonly string[]) => run(ids),
    restart: (ids: readonly string[]) => run(ids, true),
  }
}
