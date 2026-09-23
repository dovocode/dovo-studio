import { mutableStruct, mutableArray } from './schema.js'
import { decode, minValue, refine } from './schema.js'
import { Effect, Either, Schema } from 'effect'
import { runtimeRequestEffect } from './client.js'
import { connectionSchema, snapshotSchema } from './runtime.js'
import type { RuntimeConnection, RuntimeSnapshot } from './runtime.js'
import { pullPageSchema } from './pulls.js'
import type { PullSummary } from './pulls.js'
import { pullNeedsAttention } from './pull-presentation.js'
import { isSnoozed } from './task-priority.js'
import type { Task } from './workspace.js'
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
  const normalized = { ...runtimeProfile(profile.connection, profile.name), id: profile.id }
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
}
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))
export function loadRuntimeOverviewEffect(
  profile: RuntimeProfile,
  previous?: RuntimeOverview,
  onSnapshot?: (overview: RuntimeOverview) => void,
): Effect.Effect<RuntimeOverview> {
  return Effect.gen(function* () {
    const cached =
      previous?.profile.id === profile.id &&
      previous.profile.connection.token === profile.connection.token
        ? previous
        : undefined
    const result = yield* Effect.either(
      runtimeRequestEffect(
        profile.connection,
        profile.connection.address,
        '/api/snapshot',
        undefined,
        snapshotSchema,
        'GET',
        10000,
      ),
    )
    if (Either.isLeft(result))
      return {
        profile,
        snapshot: cached?.snapshot ?? null,
        connected: false,
        lastSeen: cached?.lastSeen ?? null,
        error: errorText(result.left),
        pulls: cached?.pulls ? { ...cached.pulls, partial: true } : null,
        pullError: cached?.pullError ?? null,
      }
    const snapshot = result.right
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
    const repositories = snapshot.workspace.repositories
    // Concurrency belongs to the parent fiber; interruption cancels every child request.
    const pages = yield* Effect.forEach(
      repositories,
      (repository) =>
        Effect.either(
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
      if (Either.isLeft(page)) {
        partial = true
        errors.push(`${repositories[index].name}: ${errorText(page.left)}`)
        continue
      }
      loaded++
      partial ||= page.right.hasMore || !!page.right.stale || !!page.right.refreshError
      if (page.right.refreshError)
        errors.push(`${repositories[index].name}: ${page.right.refreshError}`)
      for (const pull of page.right.pulls)
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
      lastSeen,
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
}
export function aggregateRuntimeTasks(
  entries: readonly RuntimeOverview[],
  now = Date.now(),
  includeInactive = false,
): RuntimeTask[] {
  const tasks = entries.flatMap((entry) => {
    if (!entry.snapshot) return []
    const { snapshot, profile } = entry
    const needsInput = new Set(
      [...snapshot.approvals, ...snapshot.questions].map((item) => item.taskId),
    )
    const projects = new Map(
      snapshot.workspace.repositories.map((repository) => [repository.id, repository.name]),
    )
    return snapshot.workspace.tasks
      .filter(
        (task) => !task.example && (includeInactive || (!task.archived && !isSnoozed(task, now))),
      )
      .map((task) => ({
        key: JSON.stringify([profile.id, task.id]),
        runtimeId: profile.id,
        runtimeName:
          profile.name !== new URL(profile.connection.address).hostname
            ? profile.name
            : snapshot.runtimeHost || profile.name,
        task,
        projectName: projects.get(task.repositoryId) ?? 'No project',
        needsInput: needsInput.has(task.id),
        online: entry.connected,
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
