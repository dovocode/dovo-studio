import { Effect } from 'effect'
import {
  connectionSchema,
  decode,
  runtimeProfile,
  runtimeRegistrySchema,
  upsertRuntime,
  type RuntimeRegistry,
} from '@dovo/protocol'

export const registryKey = 'dovo.runtime.registry'
export const legacyKey = 'dovo.runtime.connection'
export const legacyDraftKey = 'dovo.runtime.legacy-drafts'

/** Commit the draft association before the registry, and retain legacy data until both are durable. */
export function restoreRegistry(storage: {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
}) {
  const failure = (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause)))
  const native = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: failure })
  return Effect.gen(function* () {
    const [stored, legacy, marker] = yield* Effect.all(
      [
        native(() => storage.getItem(registryKey)),
        native(() => storage.getItem(legacyKey)),
        native(() => storage.getItem(legacyDraftKey)),
      ],
      { concurrency: 3 },
    )
    let registry: RuntimeRegistry = yield* Effect.try({
      try: () =>
        stored
          ? decode(runtimeRegistrySchema, JSON.parse(stored))
          : { version: 1 as const, activeId: null, profiles: [] },
      catch: failure,
    })
    let draftRuntimeId = marker
    if (legacy) {
      const profile = yield* Effect.try({
        try: () => runtimeProfile(decode(connectionSchema, JSON.parse(legacy))),
        catch: failure,
      })
      // Also repair a previous version's partial migration (registry committed, marker missing).
      if (!stored || (!marker && registry.profiles.some((item) => item.id === profile.id))) {
        draftRuntimeId = profile.id
        yield* native(() => storage.setItem(legacyDraftKey, profile.id))
        if (!stored) {
          registry = upsertRuntime(registry, profile)
          yield* native(() => storage.setItem(registryKey, JSON.stringify(registry)))
        }
      }
      yield* native(() => storage.removeItem(legacyKey))
    }
    return { registry, draftRuntimeId }
  }).pipe(Effect.uninterruptible)
}
