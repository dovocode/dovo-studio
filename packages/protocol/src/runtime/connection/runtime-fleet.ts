import { mutableStruct, mutableArray } from '../../shared/schema.js'
import { decode, minValue, refine } from '../../shared/schema.js'
import { Effect, Result, Schema } from 'effect'
import { RuntimeRequestError, runtimeRequestEffect } from '../../shared/client.js'
import { connectionSchema, snapshotSchema } from './runtime.js'
import type { RuntimeConnection, RuntimeSnapshot } from './runtime.js'
import { pullPageSchema } from '../../scm/pulls/pulls.js'
import type { PullSummary } from '../../scm/pulls/pulls.js'
import { pullNeedsAttention } from '../../scm/pulls/pull-presentation.js'
import { taskFamilyInputIds } from '../../tasks/delegation.js'
import { isSnoozed } from '../../tasks/task-priority.js'
import { selectPullSources } from '../../scm/pulls/pull-sources.js'
import type { Repository, Task } from '../../workspace.js'
/** People type what their computer shows, often without a scheme. Plain HTTP is the
 * supported LAN/VPN default, so a bare host is never upgraded to HTTPS. */
export function normalizeRuntimeAddress(value: string) {
  const address = value.trim().replace(/\/+$/, '')
  return !address || /^[a-z][a-z\d+.-]*:\/\//i.test(address) ? address : `http://${address}`
}
export function runtimeProfile(connection: RuntimeConnection, name?: string) {
  const parsed = decode(connectionSchema, connection)
  const url = new URL(parsed.address)
  if (['0.0.0.0', '[::]'].includes(url.hostname))
    throw new Error(
      'Use the device’s LAN, Tailscale or NetBird address. A wildcard address is only for binding the server.',
    )
  return {
    id: url.origin,
    name: name?.trim() || url.hostname,
    nameIsCustom: !!name?.trim(),
    connection: {
      ...parsed,
      address: url.origin,
    },
  }
}
// IDs remain stable when a newly paired address replaces a saved connection.
const profileSchema = mutableStruct({
  id: minValue(Schema.String, 1),
  name: minValue(Schema.String, 1),
  nameIsCustom: Schema.optional(Schema.Boolean),
  connection: connectionSchema,
})

export const pairingProofSchema = mutableStruct({
  id: Schema.String,
  secret: Schema.String,
  expiresAt: Schema.String,
})
export type PairingProof = Schema.Schema.Type<typeof pairingProofSchema>
export const pendingRuntimePairingSchema = mutableStruct({
  profile: profileSchema,
  proof: pairingProofSchema,
  previousConnection: Schema.optional(Schema.NullOr(connectionSchema)),
})
export type PendingRuntimePairing = Schema.Schema.Type<typeof pendingRuntimePairingSchema>
export const runtimeRegistrySchema = refine(
  refine(
    mutableStruct({
      version: Schema.Literal(1),
      activeId: Schema.NullOr(Schema.String),
      profiles: mutableArray(profileSchema),
      pendingPairings: Schema.optional(mutableArray(pendingRuntimePairingSchema)),
    }),
    (registry) =>
      new Set(registry.profiles.map((profile) => profile.id)).size === registry.profiles.length &&
      new Set(registry.profiles.map((profile) => profile.connection.address)).size ===
        registry.profiles.length,
    'Saved computer IDs and addresses must be unique',
  ),
  (registry) =>
    registry.activeId === null ||
    registry.profiles.some((profile) => profile.id === registry.activeId),
  'Active runtime must be saved',
)
export type RuntimeProfile = Schema.Schema.Type<typeof profileSchema>
export type RuntimeRegistry = Schema.Schema.Type<typeof runtimeRegistrySchema>
export function upsertRuntime(
  registry: RuntimeRegistry,
  profile: RuntimeProfile,
  activate = true,
): RuntimeRegistry {
  const normalized = {
    ...runtimeProfile(profile.connection, profile.name),
    id: profile.id,
    nameIsCustom: runtimeHasCustomName(profile),
  }
  if (
    registry.profiles.some(
      (item) =>
        item.id !== normalized.id && item.connection.address === normalized.connection.address,
    )
  )
    throw new Error(
      'This address is already saved as another computer. Manage that connection instead.',
    )
  const exists = registry.profiles.some((item) => item.id === normalized.id)
  return {
    ...registry,
    version: 1,
    activeId: activate ? normalized.id : registry.activeId,
    profiles: exists
      ? registry.profiles.map((item) => (item.id === normalized.id ? normalized : item))
      : [...registry.profiles, normalized],
  }
}
export function removeRuntime(registry: RuntimeRegistry, id: string): RuntimeRegistry {
  return {
    ...registry,
    version: 1,
    activeId: registry.activeId === id ? null : registry.activeId,
    profiles: registry.profiles.filter((profile) => profile.id !== id),
    ...(registry.pendingPairings
      ? { pendingPairings: registry.pendingPairings.filter((entry) => entry.profile.id !== id) }
      : {}),
  }
}
export type RuntimeOverview = {
  profile: RuntimeProfile
  snapshot: RuntimeSnapshot | null
  connected: boolean
  lastSeen: string | null
  error: string | null
  pulls: {
    total: number
    needsAttention: number
    reviewRequested: number
    partial: boolean
  } | null
  pullError: string | null
  /** The runtime rejected this device's token: it was revoked or the runtime was reset. */
  unauthorized?: boolean
}
/** Older profiles used the address hostname as their automatic label. Preserve saved overrides. */
export function runtimeHasCustomName(
  profile: Pick<RuntimeProfile, 'name' | 'nameIsCustom' | 'connection'>,
) {
  return profile.nameIsCustom ?? profile.name !== new URL(profile.connection.address).hostname
}
/** An explicit Dovo name wins; otherwise use the computer's reported hostname. */
export function runtimeComputerName({
  profile,
  snapshot,
}: {
  profile?: Pick<RuntimeProfile, 'name' | 'nameIsCustom' | 'connection'> | null
  snapshot?: Pick<RuntimeSnapshot, 'runtimeHost'> | null
}) {
  return (
    (profile && runtimeHasCustomName(profile) ? profile.name.trim() : '') ||
    snapshot?.runtimeHost?.trim() ||
    profile?.name ||
    'Unknown computer'
  )
}
/** A 401 means the saved pairing no longer works; polling again cannot fix it. */
export function isUnauthorizedRuntimeError(error: unknown) {
  return error instanceof RuntimeRequestError && error.status === 401
}
export type RuntimeReachability = 'online' | 'connecting' | 'offline'
/** A host is offline only after a request to it failed. Until then (app launch, restored
 * cache, first slow VPN round trip) it is still connecting and must not alarm the user. */
export function runtimeReachability(
  entry: Pick<RuntimeOverview, 'connected' | 'error'>,
): RuntimeReachability {
  return entry.connected ? 'online' : entry.error ? 'offline' : 'connecting'
}
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))
export function loadRuntimeOverviewEffect(
  profile: RuntimeProfile,
  previous?: RuntimeOverview,
  onSnapshot?: (overview: RuntimeOverview) => void,
  compact = false,
  useLiveSnapshot = false,
  options: { loadPulls?: boolean } = {},
): Effect.Effect<RuntimeOverview> {
  return Effect.gen(function* () {
    const cached =
      previous?.profile.id === profile.id &&
      previous.profile.connection.token === profile.connection.token &&
      previous.profile.connection.address === profile.connection.address
        ? previous
        : undefined
    const result = yield* Effect.result(
      useLiveSnapshot && cached?.connected && cached.snapshot
        ? Effect.succeed(cached.snapshot)
        : runtimeRequestEffect(
            profile.connection,
            profile.connection.address,
            compact ? '/api/snapshot?scope=overview' : '/api/snapshot',
            undefined,
            snapshotSchema,
            'GET',
            10000,
          ),
    )
    if (Result.isFailure(result))
      return {
        profile,
        snapshot: cached?.snapshot ?? null,
        connected: false,
        lastSeen: cached?.lastSeen ?? null,
        error: errorText(result.failure),
        pulls: cached?.pulls ? { ...cached.pulls, partial: true } : null,
        pullError: cached?.pullError ?? null,
        unauthorized: isUnauthorizedRuntimeError(result.failure),
      }
    const snapshot = result.success
    const lastSeen = new Date().toISOString()
    onSnapshot?.({
      profile,
      snapshot,
      connected: true,
      lastSeen,
      error: null,
      pulls: cached?.pulls ?? null,
      pullError: cached?.pullError ?? null,
    })
    if (options.loadPulls === false)
      return {
        profile,
        snapshot,
        connected: true,
        lastSeen,
        error: null,
        pulls: cached?.pulls ? { ...cached.pulls, partial: true } : null,
        pullError: cached?.pullError ?? null,
      }
    return yield* loadRuntimePullOverviewEffect(profile, snapshot, cached)
  })
}

/** Snapshot discovery finishes for the whole fleet before remote PR reads start. */
export function loadFleetPullOverviewsEffect(
  entries: readonly RuntimeOverview[],
  onOverview: (overview: RuntimeOverview) => void,
  shouldLoad: (entry: RuntimeOverview, repositories: readonly Repository[]) => boolean = () => true,
): Effect.Effect<void> {
  const sources = selectPullSources(
    entries.flatMap((entry) =>
      (entry.snapshot?.workspace.repositories ?? [])
        .filter((repository) => !repository.kind)
        .map((repository) => ({
          key: JSON.stringify([entry.profile.id, repository.id]),
          connected: entry.connected,
          repository,
          runtimeId: entry.profile.id,
        })),
    ),
  )
  return Effect.forEach(
    entries.filter((entry) => entry.snapshot),
    (entry) => {
      const snapshot = entry.snapshot
      if (!snapshot) return Effect.void
      const repositories = sources
        .filter((source) => source.runtimeId === entry.profile.id)
        .map((source) => source.repository)
      if (!repositories.length)
        return Effect.sync(() =>
          onOverview({
            ...entry,
            pulls: { total: 0, needsAttention: 0, reviewRequested: 0, partial: false },
            pullError: null,
          }),
        )
      if (!entry.connected || !shouldLoad(entry, repositories)) return Effect.void
      return loadRuntimePullOverviewEffect(entry.profile, snapshot, entry, repositories).pipe(
        Effect.tap((overview) => Effect.sync(() => onOverview(overview))),
      )
    },
    // Each runtime reads up to three repositories; do not multiply that budget by the fleet.
    { concurrency: 1, discard: true },
  )
}

function loadRuntimePullOverviewEffect(
  profile: RuntimeProfile,
  snapshot: RuntimeSnapshot,
  cached?: RuntimeOverview,
  repositories: readonly Repository[] = selectPullSources(
    snapshot.workspace.repositories
      .filter((repository) => !repository.kind)
      .map((repository) => ({ key: repository.id, repository, connected: true })),
  ).map((source) => source.repository),
): Effect.Effect<RuntimeOverview> {
  return Effect.gen(function* () {
    // Concurrency belongs to the parent fiber; interruption cancels every child request.
    const pages = yield* Effect.forEach(
      repositories,
      (repository) =>
        Effect.result(
          runtimeRequestEffect(
            profile.connection,
            profile.connection.address,
            '/api/scm/pulls/overview',
            { repositoryId: repository.id, state: 'open', page: 1, refresh: false },
            pullPageSchema,
            'POST',
            15000,
          ),
        ),
      { concurrency: 3 },
    )
    const pulls = new Map<string, PullSummary>()
    const errors: string[] = []
    let partial = false
    let loaded = 0
    for (const [index, page] of pages.entries()) {
      if (Result.isFailure(page)) {
        partial = true
        errors.push(`${repositories[index].name}: ${errorText(page.failure)}`)
        continue
      }
      loaded++
      partial ||= page.success.hasMore || !!page.success.stale || !!page.success.refreshError
      if (page.success.refreshError)
        errors.push(`${repositories[index].name}: ${page.success.refreshError}`)
      for (const pull of page.success.pulls)
        if (pull.state === 'open') {
          const existing = pulls.get(pull.url)
          if (!existing || existing.updatedAt < pull.updatedAt) pulls.set(pull.url, pull)
        }
    }
    const values = [...pulls.values()]
    return {
      profile,
      snapshot,
      connected: true,
      lastSeen: new Date().toISOString(),
      error: null,
      pulls:
        loaded || !repositories.length
          ? {
              total: values.length,
              needsAttention: values.filter(pullNeedsAttention).length,
              reviewRequested: values.filter((pull) => pull.viewerReviewRequested && !pull.draft)
                .length,
              partial,
            }
          : cached?.pulls
            ? { ...cached.pulls, partial: true }
            : null,
      pullError: errors.length ? errors.join('\n') : null,
    }
  })
}

export function loadRuntimeOverview(
  profile: RuntimeProfile,
  previous?: RuntimeOverview,
  onSnapshot?: (overview: RuntimeOverview) => void,
  signal?: AbortSignal,
): Promise<RuntimeOverview> {
  return Effect.runPromise(loadRuntimeOverviewEffect(profile, previous, onSnapshot), { signal })
}
export type RuntimeTask = {
  key: string
  runtimeId: string
  runtimeName: string
  task: Task
  projectName: string
  needsInput: boolean
  online: boolean
  reachability: RuntimeReachability
}
export function aggregateRuntimeTasks(
  entries: readonly RuntimeOverview[],
  now = Date.now(),
  includeInactive = false,
): RuntimeTask[] {
  const tasks = entries.flatMap((entry) => {
    if (!entry.snapshot) return []
    const { snapshot, profile } = entry
    const needsInput = taskFamilyInputIds(
      snapshot.workspace.tasks,
      [...snapshot.approvals, ...snapshot.questions].map((item) => item.taskId),
    )
    const projects = new Map(
      snapshot.workspace.repositories.map((repository) => [repository.id, repository.name]),
    )
    return snapshot.workspace.tasks
      .filter(
        (task) =>
          !task.example &&
          (includeInactive || (!task.archived && !task.archivedAt && !isSnoozed(task, now))),
      )
      .map((task) => ({
        key: JSON.stringify([profile.id, task.id]),
        runtimeId: profile.id,
        runtimeName: runtimeComputerName(entry),
        task,
        projectName: projects.get(task.repositoryId) ?? 'No project',
        needsInput: needsInput.has(task.id),
        online: entry.connected,
        reachability: runtimeReachability(entry),
      }))
  })
  const priority = (item: RuntimeTask) =>
    item.needsInput ? 0 : item.task.status === 'failed' ? 1 : item.task.status === 'running' ? 2 : 3
  return tasks.sort(
    (a, b) =>
      Number(!!b.task.pinned) - Number(!!a.task.pinned) ||
      priority(a) - priority(b) ||
      (b.task.updatedAt ?? b.task.createdAt).localeCompare(a.task.updatedAt ?? a.task.createdAt) ||
      a.key.localeCompare(b.key),
  )
}
