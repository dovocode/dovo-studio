import { Effect, Either } from 'effect'
import { runtimeRequestEffect, RuntimeRequestError } from './client.js'
import { responses, snapshotSchema } from './runtime.js'
import {
  upsertRuntime,
  type RuntimeRegistry,
  type PendingRuntimePairing,
  type PairingProof,
} from './runtime-fleet.js'

type WriteRegistry = (registry: RuntimeRegistry) => Effect.Effect<void, Error>
const removePending = (
  registry: RuntimeRegistry,
  id: string,
  address: string,
): RuntimeRegistry => ({
  ...registry,
  pendingPairings: registry.pendingPairings?.filter(
    (entry) => entry.proof.id !== id || entry.profile.connection.address !== address,
  ),
})
const confirmed = (registry: RuntimeRegistry, entry: PendingRuntimePairing) =>
  upsertRuntime(
    removePending(registry, entry.proof.id, entry.profile.connection.address),
    entry.profile,
  )
const confirm = (entry: PendingRuntimePairing) =>
  runtimeRequestEffect(
    null,
    entry.profile.connection.address,
    '/api/pair/confirm',
    entry.proof,
    responses.ok,
    'POST',
    5000,
  )

/** Caller owns the registry lock. Retain the old profile until confirmation AND durable commit. */
export function saveRuntimePairing(
  registry: RuntimeRegistry,
  entry: PendingRuntimePairing,
  write: WriteRegistry,
) {
  return Effect.gen(function* () {
    // Validate conflicts before issuing or durably staging a new credential.
    yield* Effect.try({
      try: () => upsertRuntime(registry, entry.profile),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    })
    entry = {
      ...entry,
      previousConnection:
        registry.profiles.find((item) => item.id === entry.profile.id)?.connection ?? null,
    }
    const staged = {
      ...registry,
      pendingPairings: [
        ...(registry.pendingPairings ?? []).filter(
          (item) =>
            item.profile.id !== entry.profile.id &&
            item.profile.connection.address !== entry.profile.connection.address,
        ),
        entry,
      ],
    }
    yield* write(staged)
    yield* confirm(entry)
    const next = confirmed(staged, entry)
    yield* write(next)
    return next
  }).pipe(Effect.uninterruptible)
}

/** A persisted candidate survives a crash or a lost confirmation/commit response. */
export function recoverRuntimePairings(registry: RuntimeRegistry, write: WriteRegistry) {
  return Effect.gen(function* () {
    let next = registry
    const pending = registry.pendingPairings ?? []
    for (const [index, entry] of pending.entries()) {
      const current = next.profiles.find((item) => item.id === entry.profile.id)?.connection
      const same = (a: typeof current, b: typeof current | null) =>
        a?.address === b?.address && a?.token === b?.token
      const superseded = pending
        .slice(index + 1)
        .some(
          (item) =>
            item.profile.id === entry.profile.id ||
            item.profile.connection.address === entry.profile.connection.address,
        )
      // Legacy journals have no predecessor: never overwrite a different saved credential.
      const matches =
        same(current, entry.profile.connection) ||
        (entry.previousConnection !== undefined
          ? same(current, entry.previousConnection)
          : !current)
      if (superseded || !matches) {
        next = removePending(next, entry.proof.id, entry.profile.connection.address)
        yield* write(next)
        continue
      }
      const expired = Date.parse(entry.proof.expiresAt) <= Date.now()
      const result = yield* Effect.either(
        expired
          ? runtimeRequestEffect(
              entry.profile.connection,
              entry.profile.connection.address,
              '/api/snapshot',
              undefined,
              snapshotSchema,
              'GET',
              5000,
            ).pipe(Effect.asVoid)
          : confirm(entry).pipe(Effect.asVoid),
      )
      if (Either.isRight(result))
        next = { ...confirmed(next, entry), activeId: next.activeId ?? entry.profile.id }
      else if (expired && result.left instanceof RuntimeRequestError && result.left.status === 401)
        next = removePending(next, entry.proof.id, entry.profile.connection.address)
      else continue // Offline: retain the durable candidate and existing connection for another recovery.
      yield* write(next)
    }
    return next
  }).pipe(Effect.uninterruptible)
}

export function cancelRuntimePairing(
  registry: RuntimeRegistry,
  address: string,
  proof: PairingProof,
  write: WriteRegistry,
) {
  return Effect.gen(function* () {
    const entry = registry.pendingPairings?.find(
      (item) => item.proof.id === proof.id && item.profile.connection.address === address,
    )
    yield* runtimeRequestEffect(null, address, '/api/pair/cancel', proof, responses.ok).pipe(
      Effect.catchAll((error) => {
        if (!(error instanceof RuntimeRequestError) || error.status !== 404)
          return Effect.fail(error)
        if (!entry) return Effect.void // No credential was ever staged by this client.
        return runtimeRequestEffect(
          entry.profile.connection,
          address,
          '/api/devices/revoke-self',
          {},
          responses.ok,
        ).pipe(
          Effect.asVoid,
          Effect.catchAll((failure) =>
            failure instanceof RuntimeRequestError && failure.status === 401
              ? Effect.void
              : Effect.fail(failure),
          ),
        )
      }),
    )
    const next = removePending(registry, proof.id, address)
    yield* write(next)
    return next
  }).pipe(Effect.uninterruptible)
}
