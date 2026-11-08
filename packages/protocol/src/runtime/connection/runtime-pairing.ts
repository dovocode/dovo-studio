import { createRuntimeClient } from '../../shared/runtime-client.js'
import { Effect, Result } from 'effect'
import { isPeerAddress } from './peer.js'
import { runtimeRequestEffect, RuntimeRequestError } from '../../shared/client.js'
import { responses, snapshotSchema, type RuntimeConnection } from './runtime.js'
import {
  upsertRuntime,
  type RuntimeRegistry,
  type PendingRuntimePairing,
  type PairingProof,
} from './runtime-fleet.js'

type WriteRegistry = (registry: RuntimeRegistry) => Effect.Effect<void, Error>
type BeforeReplace = (previous: RuntimeConnection) => Effect.Effect<void, Error>
const checkReplacement = (
  previous: RuntimeConnection | undefined,
  candidate: RuntimeConnection,
  beforeReplace?: BeforeReplace,
) =>
  previous &&
  (previous.address !== candidate.address || previous.token !== candidate.token) &&
  beforeReplace
    ? beforeReplace(previous)
    : Effect.void
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
  createRuntimeClient(entry.profile.connection).requestEffect(
    '/api/pair/confirm',
    entry.proof,
    responses.ok,
    { method: 'POST', timeoutMs: 5000 },
  )

/** Caller owns the registry lock. Retain the old profile until confirmation AND durable commit.
 * Clients with credential-scoped saved actions must check the predecessor before replacing it. */
export function saveRuntimePairing(
  registry: RuntimeRegistry,
  entry: PendingRuntimePairing,
  write: WriteRegistry,
  beforeReplace?: BeforeReplace,
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
    yield* checkReplacement(
      entry.previousConnection ?? undefined,
      entry.profile.connection,
      beforeReplace,
    )
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
    yield* checkReplacement(
      entry.previousConnection ?? undefined,
      entry.profile.connection,
      beforeReplace,
    )
    const next = confirmed(staged, entry)
    yield* write(next)
    return next
  }).pipe(Effect.uninterruptible)
}

/** A persisted candidate survives a crash or a lost confirmation/commit response. */
export function recoverRuntimePairings(
  registry: RuntimeRegistry,
  write: WriteRegistry,
  beforeReplace?: BeforeReplace,
) {
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
      yield* checkReplacement(current, entry.profile.connection, beforeReplace)
      const expired = Date.parse(entry.proof.expiresAt) <= Date.now()
      const result = yield* Effect.result(
        expired
          ? createRuntimeClient(entry.profile.connection)
              .requestEffect('/api/snapshot?scope=overview', undefined, snapshotSchema, {
                method: 'GET',
                timeoutMs: 5000,
              })
              .pipe(Effect.asVoid)
          : confirm(entry).pipe(Effect.asVoid),
      )
      if (Result.isSuccess(result)) {
        yield* checkReplacement(current, entry.profile.connection, beforeReplace)
        next = { ...confirmed(next, entry), activeId: next.activeId ?? entry.profile.id }
      } else if (
        expired &&
        result.failure instanceof RuntimeRequestError &&
        result.failure.status === 401
      )
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
    const matches = (registry.pendingPairings ?? []).filter(
      (item) => item.proof.id === proof.id && item.proof.secret === proof.secret,
    )
    const scoped = matches.filter(
      (item) => item.profile.connection.address === address || item.claimAddress === address,
    )
    // Older internet journals did not record their bootstrap address. Their full
    // secret identifies the request, but only use the fallback when unambiguous.
    const legacy = isPeerAddress(address)
      ? matches.filter(
          (item) => !item.claimAddress && isPeerAddress(item.profile.connection.address),
        )
      : []
    const candidates = scoped.length ? scoped : legacy
    if (candidates.length > 1)
      return yield* Effect.fail(new Error('Cannot safely identify this pending pairing.'))
    const entry = candidates[0]
    // A staged device's permanent route remains usable when its QR tunnel expires.
    // Issue one cancel; an uncertain network failure keeps the journal for recovery.
    const cancel = entry
      ? createRuntimeClient(entry.profile.connection).requestEffect(
          '/api/pair/cancel',
          proof,
          responses.ok,
          { method: 'POST', timeoutMs: 5000 },
        )
      : runtimeRequestEffect(null, address, '/api/pair/cancel', proof, responses.ok)
    yield* cancel.pipe(
      Effect.catch((error) => {
        if (!(error instanceof RuntimeRequestError) || error.status !== 404)
          return Effect.fail(error)
        if (!entry) return Effect.void // No credential was ever staged by this client.
        return createRuntimeClient(entry.profile.connection)
          .requestEffect('/api/devices/revoke-self', {}, responses.ok)
          .pipe(
            Effect.asVoid,
            Effect.catch((failure) =>
              failure instanceof RuntimeRequestError && failure.status === 401
                ? Effect.void
                : Effect.fail(failure),
            ),
          )
      }),
    )
    const next = entry
      ? { ...registry, pendingPairings: registry.pendingPairings?.filter((item) => item !== entry) }
      : registry
    yield* write(next)
    return next
  }).pipe(Effect.uninterruptible)
}
