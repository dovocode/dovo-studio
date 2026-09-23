import { afterEach, expect, it, vi } from 'vitest'
import { Deferred, Effect } from 'effect'
import { saveRuntimePairing, recoverRuntimePairings, cancelRuntimePairing } from './runtime-pairing'
import { runtimeProfile, runtimeRegistrySchema, type RuntimeRegistry } from './runtime-fleet'
import { decode } from './schema'

const previous = runtimeProfile({
  address: 'http://vpn-host:51464',
  token: 'previous-device-token-audit',
})
const candidate = runtimeProfile({ address: previous.id, token: 'replacement-device-token-audit' })
const entry = () => ({
  profile: candidate,
  previousConnection: previous.connection,
  proof: {
    id: 'request',
    secret: 'pairing-secret-audit-only',
    expiresAt: new Date(Date.now() + 120000).toISOString(),
  },
})
const initial = (): RuntimeRegistry => ({ version: 1, activeId: previous.id, profiles: [previous] })
afterEach(() => vi.unstubAllGlobals())
const ok = () => Response.json({ ok: true })
const fail = (message: string) => Effect.fail(new Error(message))

it('does not confirm or replace the old connection before the candidate is durable', async () => {
  let saved = initial()
  const gate = Effect.runSync(Deferred.make<void>())
  const fetcher = vi.fn<typeof fetch>(async () => ok())
  vi.stubGlobal('fetch', fetcher)
  let writes = 0
  const pending = Effect.runPromise(
    saveRuntimePairing(saved, entry(), (next) =>
      Effect.gen(function* () {
        if (++writes === 1) yield* Deferred.await(gate)
        saved = decode(runtimeRegistrySchema, JSON.parse(JSON.stringify(next)))
      }),
    ),
  )
  await vi.waitFor(() => expect(writes).toBe(1))
  expect(fetcher).not.toHaveBeenCalled()
  expect(saved.profiles).toEqual([previous])
  await Effect.runPromise(Deferred.succeed(gate, undefined))
  await pending
  expect(saved.profiles).toEqual([candidate])
  expect(saved.pendingPairings).toEqual([])
})

it('propagates secure-storage failure without confirming trust', async () => {
  const fetcher = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetcher)
  await expect(
    Effect.runPromise(saveRuntimePairing(initial(), entry(), () => fail('Keychain locked'))),
  ).rejects.toThrow('Keychain locked')
  expect(fetcher).not.toHaveBeenCalled()
})

it('keeps the previous credential through failed confirmation and cancellation', async () => {
  let saved = initial()
  const pending = entry()
  const write = (next: RuntimeRegistry) =>
    Effect.sync(() => {
      saved = next
    })
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ error: 'Offline' }, { status: 503 }))
    .mockResolvedValueOnce(ok())
  vi.stubGlobal('fetch', fetcher)
  await expect(Effect.runPromise(saveRuntimePairing(saved, pending, write))).rejects.toThrow(
    'Offline',
  )
  expect(saved.profiles).toEqual([previous])
  expect(saved.pendingPairings).toEqual([pending])
  await Effect.runPromise(cancelRuntimePairing(saved, previous.id, pending.proof, write))
  expect(saved.profiles).toEqual([previous])
  expect(saved.pendingPairings).toEqual([])
})

it('recovers a confirmed token after the final credential write fails', async () => {
  let saved = initial()
  let writes = 0
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () => ok()),
  )
  await expect(
    Effect.runPromise(
      saveRuntimePairing(saved, entry(), (next) =>
        ++writes === 2
          ? fail('Disk full')
          : Effect.sync(() => {
              saved = next
            }),
      ),
    ),
  ).rejects.toThrow('Disk full')
  expect(saved.profiles).toEqual([previous])
  expect(saved.pendingPairings?.[0].profile.connection.token).toBe(candidate.connection.token)
  const reopened = decode(runtimeRegistrySchema, JSON.parse(JSON.stringify(saved)))
  await Effect.runPromise(
    recoverRuntimePairings(reopened, (next) =>
      Effect.sync(() => {
        saved = next
      }),
    ),
  )
  expect(saved.profiles).toEqual([candidate])
  expect(saved.pendingPairings).toEqual([])
})

it('retains the journal while offline during recovery', async () => {
  const pending = entry()
  const saved = { ...initial(), pendingPairings: [pending] }
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () => {
      throw new Error('Offline')
    }),
  )
  const writes: RuntimeRegistry[] = []
  expect(
    await Effect.runPromise(
      recoverRuntimePairings(saved, (next) =>
        Effect.sync(() => {
          writes.push(next)
        }),
      ),
    ),
  ).toEqual(saved)
  expect(writes).toEqual([])
})

it('removes expired provisional credentials without replacing the old connection', async () => {
  const pending = { ...entry(), proof: { ...entry().proof, expiresAt: new Date(0).toISOString() } }
  const saved = { ...initial(), pendingPairings: [pending] }
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () =>
      Response.json({ error: 'Device authentication required' }, { status: 401 }),
    ),
  )
  const result = await Effect.runPromise(recoverRuntimePairings(saved, () => Effect.void))
  expect(result.profiles).toEqual([previous])
  expect(result.pendingPairings).toEqual([])
})

it('revokes only the staged device if the pairing request has already expired', async () => {
  const pending = entry()
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ error: 'Expired' }, { status: 404 }))
    .mockResolvedValueOnce(ok())
  vi.stubGlobal('fetch', fetcher)
  const result = await Effect.runPromise(
    cancelRuntimePairing(
      { ...initial(), pendingPairings: [pending] },
      previous.id,
      pending.proof,
      () => Effect.void,
    ),
  )
  expect(fetcher.mock.calls[1]?.[0]).toEqual(new URL(previous.id + '/api/devices/revoke-self'))
  expect(fetcher.mock.calls[1]?.[1]?.headers).toMatchObject({
    Authorization: `Bearer ${candidate.connection.token}`,
  })
  expect(result.profiles).toEqual([previous])
})

it('keeps another host pending when request identifiers collide', async () => {
  const pending = entry()
  const other = {
    ...pending,
    profile: runtimeProfile({
      address: 'http://other-vpn-host:51464',
      token: 'other-device-token-audit',
    }),
  }
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () => ok()),
  )
  const result = await Effect.runPromise(
    cancelRuntimePairing(
      { ...initial(), pendingPairings: [pending, other] },
      previous.id,
      pending.proof,
      () => Effect.void,
    ),
  )
  expect(result.pendingPairings).toEqual([other])
  expect(result.profiles).toEqual([previous])
})

it('updates an address only after confirmation, retaining the saved computer ID', async () => {
  const updated = {
    ...entry(),
    profile: {
      ...candidate,
      connection: { ...candidate.connection, address: 'http://new-vpn:8787' },
    },
  }
  let saved = initial()
  const writes: RuntimeRegistry[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () => ok()),
  )
  await Effect.runPromise(
    saveRuntimePairing(saved, updated, (next) =>
      Effect.sync(() => {
        saved = decode(runtimeRegistrySchema, next)
        writes.push(saved)
      }),
    ),
  )
  expect(writes[0].profiles).toEqual([previous])
  expect(saved.profiles).toEqual([updated.profile])
  expect(saved.activeId).toBe(previous.id)
})
it('does not steal the active computer selection during background recovery', async () => {
  const other = runtimeProfile({ address: 'http://other:8787', token: 'other-device-token-123456' })
  const saved = {
    ...initial(),
    activeId: other.id,
    profiles: [previous, other],
    pendingPairings: [entry()],
  }
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () => ok()),
  )
  const recovered = await Effect.runPromise(recoverRuntimePairings(saved, () => Effect.void))
  expect(recovered.activeId).toBe(other.id)
})

it('does not stage or confirm an address already saved as another computer', async () => {
  const other = runtimeProfile({ address: 'http://other:8787', token: 'other-device-token-123456' })
  const saved = { ...initial(), profiles: [previous, other] }
  const pending = { ...entry(), profile: { ...candidate, connection: other.connection } }
  const fetcher = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetcher)
  const write = vi.fn<() => Effect.Effect<void>>(() => Effect.void)
  await expect(Effect.runPromise(saveRuntimePairing(saved, pending, write))).rejects.toThrow(
    'already saved',
  )
  expect(write).not.toHaveBeenCalled()
  expect(fetcher).not.toHaveBeenCalled()
})

it('does not let an older journal overwrite a successful newer pairing', async () => {
  let saved: RuntimeRegistry = { ...initial(), pendingPairings: [entry()] }
  const newer = {
    ...entry(),
    proof: { ...entry().proof, id: 'newer' },
    profile: {
      ...candidate,
      connection: { ...candidate.connection, token: 'newer-token-for-regression' },
    },
  }
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () => ok()),
  )
  const write = (next: RuntimeRegistry) =>
    Effect.sync(() => {
      saved = next
    })
  await Effect.runPromise(saveRuntimePairing(saved, newer, write))
  await Effect.runPromise(recoverRuntimePairings(saved, write))
  expect(saved.profiles[0].connection.token).toBe(newer.profile.connection.token)
  expect(saved.pendingPairings).toEqual([])
})
it('discards stale recovery when the saved credential no longer matches its predecessor', async () => {
  const newer = {
    ...candidate,
    connection: { ...candidate.connection, token: 'newest-credential-token' },
  }
  const fetcher = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetcher)
  const saved = await Effect.runPromise(
    recoverRuntimePairings(
      { ...initial(), profiles: [newer], pendingPairings: [entry()] },
      () => Effect.void,
    ),
  )
  expect(saved.profiles).toEqual([newer])
  expect(saved.pendingPairings).toEqual([])
  expect(fetcher).not.toHaveBeenCalled()
})
