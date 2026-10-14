import { expect, it, vi } from 'vite-plus/test'
import {
  createRuntimeReadCache,
  type ArtifactLibraryEntry,
  type CacheStorage,
  type RuntimeProfile,
  type RuntimeReadCache,
} from '@dovo/protocol'
import {
  artifactOwnerKey,
  createArtifactLibraryMemory,
  createRequestGuard,
  loadArtifactSource,
} from './artifact-library'

const artifact: ArtifactLibraryEntry = {
  id: '00000000-0000-4000-8000-000000000001',
  taskId: 'thread',
  title: 'Launch brief',
  format: 'markdown',
  revision: 1,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-02T00:00:00Z',
  threadTitle: 'Research',
  threadState: 'active',
}
const profile = (
  token = 'paired-token',
  address = 'http://studio.local:51464',
): RuntimeProfile => ({
  id: 'studio',
  name: 'Studio',
  connection: { address, token },
})
function storage() {
  const values = new Map<string, string>()
  const store: CacheStorage = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => void values.set(key, value),
    removeItem: async (key) => void values.delete(key),
    removePrefix: async (prefix) => {
      for (const key of values.keys()) if (key.startsWith(prefix)) values.delete(key)
    },
  }
  // Providers reuse one replica per pairing, as `runtimeReadCache` does.
  const replicas = new Map<string, RuntimeReadCache>()
  const caches = (owner: RuntimeProfile) => () => {
    const key = artifactOwnerKey(owner)
    const replica =
      replicas.get(key) ??
      createRuntimeReadCache(owner.connection, store, async (text) => `digest:${text}`)
    replicas.set(key, replica)
    return replica
  }
  return Object.assign(caches, { values })
}

it('keeps healthy rows through a disconnect as an offline status, not a failure', async () => {
  const memory = createArtifactLibraryMemory(4)
  const cache = storage()(profile())
  const owner = artifactOwnerKey(profile())
  const live = await loadArtifactSource({
    owner,
    connected: true,
    read: async () => ({ artifacts: [artifact] }),
    cache,
    memory,
    now: () => new Date('2026-10-14T09:00:00Z'),
  })
  expect(live).toEqual({
    status: 'ready',
    saved: { artifacts: [artifact], savedAt: '2026-10-14T09:00:00.000Z' },
  })
  const offline = await loadArtifactSource({
    owner,
    connected: false,
    read: async () => {
      throw new Error('An offline computer must not be read')
    },
    cache,
    memory,
  })
  expect(offline).toEqual({ status: 'offline', saved: live.saved })
})

it('restores saved rows for the same pairing after the view and memory are gone', async () => {
  const caches = storage()
  await loadArtifactSource({
    owner: artifactOwnerKey(profile()),
    connected: true,
    read: async () => ({ artifacts: [artifact] }),
    cache: caches(profile()),
    memory: createArtifactLibraryMemory(4),
  })
  await vi.waitFor(() => expect(caches.values.size).toBeGreaterThan(0))
  const restored = await loadArtifactSource({
    owner: artifactOwnerKey(profile()),
    connected: false,
    read: async () => ({ artifacts: [] }),
    cache: caches(profile()),
    memory: createArtifactLibraryMemory(4),
  })
  expect(restored.status).toBe('offline')
  expect(restored.saved?.artifacts).toEqual([artifact])
  // A re-paired or re-addressed computer never borrows the previous credential's rows.
  for (const changed of [profile('new-token'), profile('paired-token', 'http://studio.vpn:51464')])
    expect(
      await loadArtifactSource({
        owner: artifactOwnerKey(changed),
        connected: false,
        read: async () => ({ artifacts: [] }),
        cache: caches(changed),
        memory: createArtifactLibraryMemory(4),
      }),
    ).toEqual({ status: 'offline', saved: null })
})

it('reports real request failures separately and keeps the last healthy rows', async () => {
  const memory = createArtifactLibraryMemory(4)
  const owner = artifactOwnerKey(profile())
  const saved = { artifacts: [artifact], savedAt: '2026-10-14T09:00:00.000Z' }
  memory.remember(owner, saved)
  expect(
    await loadArtifactSource({
      owner,
      connected: true,
      read: async () => {
        throw new Error('403 Forbidden')
      },
      cache: () => {
        throw new Error('Cache unavailable')
      },
      memory,
    }),
  ).toEqual({ status: 'failed', error: '403 Forbidden', saved })
})

it('bounds remembered owners and forgets removed connections', () => {
  const memory = createArtifactLibraryMemory(2)
  const saved = { artifacts: [], savedAt: '2026-10-14T09:00:00.000Z' }
  memory.remember('a', saved)
  memory.remember('b', saved)
  memory.recall('a')
  memory.remember('a', saved)
  memory.remember('c', saved)
  expect([memory.recall('a'), memory.recall('b'), memory.recall('c')]).toEqual([
    saved,
    undefined,
    saved,
  ])
  memory.retain(new Set(['c']))
  expect(memory.recall('a')).toBeUndefined()
  expect(memory.recall('c')).toBe(saved)
})

it('discards slower earlier replies for the same owner only', () => {
  const guard = createRequestGuard()
  const slow = guard.begin('a')
  const other = guard.begin('b')
  const fresh = guard.begin('a')
  expect([slow(), other(), fresh()]).toEqual([false, true, true])
  guard.cancel()
  const next = guard.begin('a')
  expect([fresh(), next()]).toEqual([false, true])
})

it('keeps a slow reply from an unmounted view out of the memory and replica', async () => {
  const memory = createArtifactLibraryMemory(4)
  const caches = storage()
  const owner = artifactOwnerKey(profile())
  const saved = { artifacts: [artifact], savedAt: '2026-10-14T09:00:00.000Z' }
  memory.remember(owner, saved)
  const guard = createRequestGuard()
  let reply!: (value: { artifacts: ArtifactLibraryEntry[] }) => void
  const slow = loadArtifactSource({
    owner,
    connected: true,
    read: () => new Promise((resolve) => (reply = resolve)),
    cache: caches(profile()),
    current: guard.begin(owner),
    memory,
  })
  // Section navigation unmounts the view before the slow read returns.
  guard.cancel()
  await vi.waitFor(() => expect(reply).toBeDefined())
  reply({ artifacts: [] })
  expect((await slow).saved?.artifacts).toEqual([])
  expect(memory.recall(owner)).toBe(saved)
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(caches.values.size).toBe(0)
  // The remounted view recalls the last current rows, not the obsolete reply.
  expect(
    await loadArtifactSource({
      owner,
      connected: false,
      read: async () => ({ artifacts: [] }),
      cache: caches(profile()),
      current: createRequestGuard().begin(owner),
      memory,
    }),
  ).toEqual({ status: 'offline', saved })
})

it('drops in-flight reads for a re-paired connection so they cannot refill memory', async () => {
  const memory = createArtifactLibraryMemory(4)
  const before = artifactOwnerKey(profile())
  const after = artifactOwnerKey(profile('new-token'))
  const guard = createRequestGuard()
  let reply!: (value: { artifacts: ArtifactLibraryEntry[] }) => void
  const slow = loadArtifactSource({
    owner: before,
    connected: true,
    read: () => new Promise((resolve) => (reply = resolve)),
    cache: storage()(profile()),
    current: guard.begin(before),
    memory,
  })
  memory.retain(new Set([after]))
  guard.retain(new Set([after]))
  await vi.waitFor(() => expect(reply).toBeDefined())
  reply({ artifacts: [artifact] })
  await slow
  expect([memory.recall(before), memory.recall(after)]).toEqual([undefined, undefined])
})
