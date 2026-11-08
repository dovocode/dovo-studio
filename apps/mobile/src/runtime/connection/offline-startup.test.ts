import { expect, it, vi } from 'vite-plus/test'
import { Effect } from 'effect'
import {
  cachedRuntimeThread,
  createRuntimeReadCache,
  decode,
  runtimeProfile,
  runtimeSnapshotCacheSchema,
  snapshotSchema,
  writeRuntimeSnapshotCache,
  type CacheStorage,
  type RuntimeOverview,
  type Task,
} from '@dovo/protocol'
import { hydrateOfflineOverview, settleMutationEffect, startupReadCache } from './offline-startup'

const connection = { address: 'http://computer.local:51464', token: 'test-device-credential-123' }
const profile = runtimeProfile(connection)
const task = (id: string, historyRevision = 0): Task => ({
  id,
  title: id,
  agentId: '',
  repositoryId: '',
  status: 'review',
  createdAt: '2026-10-02',
  draft: '',
  example: false,
  historyRevision,
  messages: [{ id: `${id}-reply`, role: 'assistant', text: `${id} history` }],
  files: [],
})
const snapshot = (tasks: Task[], detailTaskIds: string[], revision = 1) =>
  decode(snapshotSchema, {
    revision,
    owner: false,
    detailTaskIds,
    workspace: {
      version: 1,
      runtimeAddress: '',
      agents: [],
      repositories: [],
      tasks,
      automations: [],
    },
    approvals: [],
    questions: [],
    terminals: [],
    runs: [],
    devices: [],
    pendingDevices: [],
  })
function memoryStorage() {
  const entries = new Map<string, string>()
  const snapshotReads = { count: 0 }
  const storage: CacheStorage = {
    async getItem(key) {
      if (key.endsWith('.snapshot')) snapshotReads.count++
      return entries.get(key) ?? null
    },
    async setItem(key, value) {
      entries.set(key, value)
    },
    async removeItem(key) {
      entries.delete(key)
    },
    async removePrefix(prefix) {
      for (const key of entries.keys()) if (key.startsWith(prefix)) entries.delete(key)
    },
  }
  return { storage, snapshotReads }
}
async function seededCache() {
  const { storage, snapshotReads } = memoryStorage()
  const seed = createRuntimeReadCache(connection, storage, async (value) => value)
  await seed.write('snapshot', {
    snapshot: snapshot([task('a'), task('b')], ['a', 'b']),
    lastSeen: '2026-10-01T10:00:00.000Z',
    pulls: { total: 2, needsAttention: 1, reviewRequested: 0, partial: false },
  })
  await seed.close()
  snapshotReads.count = 0
  return {
    cache: startupReadCache(createRuntimeReadCache(connection, storage, async (value) => value)),
    snapshotReads,
  }
}

it('hands the startup snapshot decode to the cache writer instead of decoding it again', async () => {
  const { cache, snapshotReads } = await seededCache()
  const startup = await Effect.runPromise(cache.startupSnapshotEffect())
  expect(startup?.value.snapshot.workspace.tasks.map((item) => item.id)).toEqual(['a', 'b'])
  expect(snapshotReads.count).toBe(1)
  // The live snapshot no longer carries "b" in detail. The writer still retains its cached thread.
  await Effect.runPromise(
    writeRuntimeSnapshotCache(cache, {
      snapshot: snapshot([task('a'), task('b')], ['a'], 2),
      lastSeen: '2026-10-01T10:05:00.000Z',
      pulls: null,
    }),
  )
  expect(snapshotReads.count).toBe(1)
  expect(cachedRuntimeThread(cache, 'b')?.messages[0]?.text).toBe('b history')
  // The handoff is used once; later reads observe the written value from storage.
  const reread = await cache.read('snapshot', runtimeSnapshotCacheSchema)
  expect(snapshotReads.count).toBe(2)
  expect(reread?.value.snapshot.revision).toBe(2)
  await cache.close()
})

it('never hands over a startup decode superseded by a write', async () => {
  const { cache, snapshotReads } = await seededCache()
  await Effect.runPromise(cache.startupSnapshotEffect())
  await cache.write('snapshot', {
    snapshot: snapshot([task('c')], ['c'], 3),
    lastSeen: null,
    pulls: null,
  })
  const next = await cache.read('snapshot', runtimeSnapshotCacheSchema)
  expect(next?.value.snapshot.workspace.tasks.map((item) => item.id)).toEqual(['c'])
  expect(snapshotReads.count).toBe(2)
  await cache.close()
  expect(cache.closed).toBe(true)
  expect(await cache.read('snapshot', runtimeSnapshotCacheSchema)).toBeNull()
})

it('drops the handoff when the cache closes and rejects promise reads with the cache error', async () => {
  const { cache } = await seededCache()
  await Effect.runPromise(cache.startupSnapshotEffect())
  await cache.close()
  expect(await cache.read('snapshot', runtimeSnapshotCacheSchema)).toBeNull()
  const failing = startupReadCache(
    createRuntimeReadCache(
      connection,
      {
        getItem: async () => {
          throw new Error('Disk unavailable')
        },
        setItem: async () => {},
        removeItem: async () => {},
        removePrefix: async () => {},
      },
      async (value) => value,
    ),
  )
  await expect(failing.read('snapshot', runtimeSnapshotCacheSchema)).rejects.toMatchObject({
    message: 'Disk unavailable',
  })
})

const empty: RuntimeOverview = {
  profile,
  snapshot: null,
  connected: false,
  lastSeen: null,
  error: null,
  pulls: null,
  pullError: null,
}
const cached = {
  snapshot: snapshot([task('saved')], ['saved']),
  lastSeen: '2026-10-01T10:00:00.000Z',
  pulls: { total: 2, needsAttention: 1, reviewRequested: 0, partial: false },
}

it('fills a launch overview from the offline cache without hiding a connection error', () => {
  const offline = hydrateOfflineOverview(
    { ...empty, error: 'Connection refused', unauthorized: true },
    cached,
  )
  expect(offline.snapshot?.workspace.tasks.map((item) => item.id)).toEqual(['saved'])
  expect(offline.lastSeen).toBe(cached.lastSeen)
  expect(offline.pulls).toEqual({ ...cached.pulls, partial: true })
  expect(offline.error).toBe('Connection refused')
  expect(offline.unauthorized).toBe(true)
  expect(offline.connected).toBe(false)
})

it('never replaces network state that arrived before the offline cache', () => {
  const live: RuntimeOverview = {
    ...empty,
    snapshot: snapshot([task('live')], ['live'], 9),
    connected: true,
    lastSeen: '2026-10-01T11:00:00.000Z',
  }
  expect(hydrateOfflineOverview(live, cached)).toBe(live)
  // A later failed poll keeps the newer network snapshot too.
  const dropped = { ...live, connected: false, error: 'Timed out' }
  expect(hydrateOfflineOverview(dropped, cached)).toBe(dropped)
})

it('settles mutations without a snapshot read while the live stream is online', async () => {
  const refresh = vi.fn<(profile: unknown) => Effect.Effect<void>>(() => Effect.void)
  await Effect.runPromise(settleMutationEffect(profile, refresh, () => true))
  expect(refresh).not.toHaveBeenCalled()
  await Effect.runPromise(settleMutationEffect(profile, refresh, () => false))
  expect(refresh).toHaveBeenCalledWith(profile)
  // Refresh failures are published by the refresh itself and never fail the committed mutation.
  await expect(
    Effect.runPromise(
      settleMutationEffect(
        profile,
        () => Effect.fail(new Error('Offline')),
        () => false,
      ),
    ),
  ).resolves.toBeUndefined()
})
