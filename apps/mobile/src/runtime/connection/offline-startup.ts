import {
  runtimeSnapshotCacheSchema,
  runtimeSyncOnline,
  type CachedRead,
  type ReadCacheError,
  type RuntimeConnection,
  type RuntimeOverview,
  type RuntimeProfile,
  type RuntimeReadCache,
} from '@dovo/protocol'
import { Effect, Result } from 'effect'

type SnapshotEnvelope = typeof runtimeSnapshotCacheSchema.Type

/** A read cache whose startup snapshot decode is reused by the next snapshot reader. */
export type StartupReadCache = RuntimeReadCache & {
  /**
   * Decode the saved snapshot for offline startup. The decoded value is retained for exactly one
   * following `snapshot` read, normally the cache writer loading its replica, unless a write,
   * removal, clear or close supersedes it first.
   */
  readonly startupSnapshotEffect: () => Effect.Effect<
    CachedRead<SnapshotEnvelope> | null,
    ReadCacheError
  >
}

const snapshotKeys = new Set(['snapshot', 'snapshot-freshness'])
// Readers pass their own codec; only the startup codec's decoded value can be handed over.
const startupSchema: unknown = runtimeSnapshotCacheSchema

export function startupReadCache(cache: RuntimeReadCache): StartupReadCache {
  // Every change to the stored snapshot advances the version, so a read that started before
  // the change can never be handed to a later reader.
  let version = 0
  let handoff: { version: number; value: CachedRead<SnapshotEnvelope> } | undefined
  const supersede = () => {
    version++
    handoff = undefined
  }
  const changed = <A, E>(key: string | null, effect: Effect.Effect<A, E>) =>
    key === null || snapshotKeys.has(key)
      ? Effect.sync(supersede).pipe(Effect.andThen(effect), Effect.ensuring(Effect.sync(supersede)))
      : effect
  // Promise methods reject with the cache's own error, as the wrapped cache does.
  const run = async <A>(effect: Effect.Effect<A, ReadCacheError>) => {
    const result = await Effect.runPromise(Effect.result(effect))
    if (Result.isFailure(result)) throw result.failure
    return result.success
  }
  const readEffect: RuntimeReadCache['readEffect'] = (key, schema) =>
    Effect.suspend(() => {
      const retained = handoff
      if (key === 'snapshot' && retained && schema === startupSchema) {
        handoff = undefined
        if (retained.version === version && !cache.closed)
          // The schema identity check above guarantees the retained value's decoded type.
          return Effect.succeed(retained.value as CachedRead<(typeof schema)['Type']>)
      }
      return cache.readEffect(key, schema)
    })
  const writeEffect = (key: string, value: unknown) => changed(key, cache.writeEffect(key, value))
  const removeEffect = (key: string) => changed(key, cache.removeEffect(key))
  const clearEffect = () => changed(null, cache.clearEffect())
  const closeEffect = () => changed(null, cache.closeEffect())
  const startupSnapshotEffect = () =>
    Effect.suspend(() => {
      const started = version
      return cache.readEffect('snapshot', runtimeSnapshotCacheSchema).pipe(
        Effect.tap((value) =>
          Effect.sync(() => {
            handoff = value && version === started ? { version, value } : undefined
          }),
        ),
      )
    })
  return {
    get closed() {
      return cache.closed
    },
    readEffect,
    writeEffect,
    removeEffect,
    clearEffect,
    closeEffect,
    startupSnapshotEffect,
    read: (key, schema) => run(readEffect(key, schema)),
    write: (key, value) => run(writeEffect(key, value)),
    remove: (key) => run(removeEffect(key)),
    clear: () => run(clearEffect()),
    close: () => run(closeEffect()),
  }
}

/**
 * Apply a saved snapshot to an overview restored at launch. Network state may arrive first now
 * that the selected computer connects without waiting for every cache; it is always newer, so a
 * cached snapshot only fills an entry that has no snapshot yet and never marks it offline.
 */
export function hydrateOfflineOverview(
  entry: RuntimeOverview,
  cached: SnapshotEnvelope,
): RuntimeOverview {
  if (entry.connected || entry.snapshot) return entry
  return {
    ...entry,
    snapshot: {
      ...cached.snapshot,
      approvals: [],
      questions: [],
      terminals: [],
      pendingDevices: [],
    },
    lastSeen: entry.lastSeen ?? cached.lastSeen,
    pulls: entry.pulls ?? (cached.pulls ? { ...cached.pulls, partial: true } : null),
  }
}

/**
 * Settle a committed mutation. An online live stream publishes the resulting snapshot, and the
 * provider's lifecycle-owned writer persists it, so the caller continues at once. Without a live
 * stream the confirming snapshot read is still awaited. Its failures are published in overview
 * state by `refresh`, as before, and never fail the committed mutation.
 */
export function settleMutationEffect<E>(
  profile: RuntimeProfile,
  refresh: (profile: RuntimeProfile) => Effect.Effect<void, E>,
  online: (connection: RuntimeConnection) => boolean = runtimeSyncOnline,
): Effect.Effect<void> {
  return Effect.suspend(() =>
    online(profile.connection) ? Effect.void : refresh(profile).pipe(Effect.ignore),
  )
}
