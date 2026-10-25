import { expect, it, vi } from 'vite-plus/test'
import { decode } from '../../shared/schema.js'
import { runtimeProfile } from '../../runtime/connection/runtime-fleet.js'
import { createRuntimeReadCache, type CacheStorage } from '../../runtime/cache/read-cache.js'
import { usageHistorySchema, type UsageHistoryResult } from './usage-history.js'
import type { UsageHub } from '../workflow/plan-limits.js'
import { refreshUsageEntry, type UsageRead } from './usage-refresh.js'

function fixture() {
  const profile = runtimeProfile({
    address: 'http://host:51464',
    token: 'test-device-token-123456789',
  })
  const values = new Map<string, string>()
  const storage: CacheStorage = {
    async getItem(key) {
      return values.get(key) ?? null
    },
    async setItem(key, value) {
      values.set(key, value)
    },
    async removeItem(key) {
      values.delete(key)
    },
    async removePrefix(prefix) {
      for (const key of values.keys()) if (key.startsWith(prefix)) values.delete(key)
    },
  }
  const cache = createRuntimeReadCache(profile.connection, storage, async () => 'test-scope')
  const history: UsageHistoryResult = { sourceId: 'host', records: [], notices: [] }
  return { profile, cache, history }
}

it('publishes and caches history while a quota read is still pending, preserving history on quota failure', async () => {
  const { profile, cache, history } = fixture()
  let rejectLimits: (cause: Error) => void = () => {}
  const limits = new Promise<never>((_, reject) => {
    rejectLimits = reject
  })
  let published: () => void = () => {}
  const publication = new Promise<void>((resolve) => {
    published = resolve
  })
  const read: UsageRead = async (_, path, __, schema) => {
    if (path === '/api/usage/limits/read') return limits
    return decode(schema, history)
  }
  const refresh = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  const pending = refreshUsageEntry({
    profile,
    cache,
    read,
    refresh,
    connected: true,
    force: false,
    publish(value) {
      expect(value).toEqual(history)
      published()
    },
  })
  await publication
  rejectLimits(new Error('Quota service unavailable'))
  expect(await pending).toEqual(['Quota service unavailable'])
  expect(refresh).not.toHaveBeenCalled()
  expect((await cache.read('usage-history', usageHistorySchema))?.value).toEqual(history)
})

it('uses cached usage offline without issuing a host request', async () => {
  const { profile, cache, history } = fixture()
  await cache.write('usage-history', history)
  const requests: string[] = []
  const read: UsageRead = async (_, path) => {
    requests.push(path)
    throw new Error('offline')
  }
  const publish = vi.fn<(history: UsageHistoryResult) => void>()
  const refresh = vi.fn<() => Promise<void>>()
  expect(
    await refreshUsageEntry({
      profile,
      cache,
      read,
      refresh,
      publish,
      connected: false,
      force: true,
    }),
  ).toEqual([])
  expect(publish).toHaveBeenCalledWith(history)
  expect(requests).toEqual([])
  expect(refresh).not.toHaveBeenCalled()
})

it('reads only subscription windows on Limits without loading history from disk or publishing it', async () => {
  const { profile, cache } = fixture()
  const readCache = vi.spyOn(cache, 'read')
  const requests: string[] = []
  const read: UsageRead = async (_, path, __, schema) => {
    requests.push(path)
    return decode(schema, { checkedAt: new Date().toISOString(), accounts: [] })
  }
  const refresh = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  const publish = vi.fn<(value: UsageHistoryResult) => void>()
  expect(
    await refreshUsageEntry({
      profile,
      cache,
      read,
      refresh,
      publish,
      connected: true,
      force: true,
      kind: 'limits',
    }),
  ).toEqual([])
  expect(requests).toEqual(['/api/usage/limits/read'])
  expect(readCache).not.toHaveBeenCalled()
  expect(publish).not.toHaveBeenCalled()
  expect(refresh).toHaveBeenCalledOnce()
})

it('refreshes costs and tokens without opening a provider subscription control channel', async () => {
  const { profile, cache, history } = fixture()
  const requests: string[] = []
  const read: UsageRead = async (_, path, __, schema) => {
    requests.push(path)
    return decode(schema, history)
  }
  const refresh = vi.fn<() => Promise<void>>()
  const publish = vi.fn<(value: UsageHistoryResult) => void>()
  await refreshUsageEntry({
    profile,
    cache,
    read,
    refresh,
    publish,
    connected: true,
    force: false,
    kind: 'history',
  })
  expect(requests).toEqual(['/api/usage/history/read'])
  expect(publish).toHaveBeenCalledWith(history)
  expect(refresh).not.toHaveBeenCalled()
})

it('replicates only public hub readings for offline Limits and clears unsupported runtime data', async () => {
  const { profile, cache } = fixture()
  const hubs: UsageHub[] = [
    { id: 'hub', label: 'Hub', url: 'http://hub/', enabled: true, limits: [] },
  ]
  const publishHubs = vi.fn<(value: typeof hubs) => void>()
  const refresh = vi.fn<() => Promise<void>>(async () => {})
  const read: UsageRead = async (_, path, __, schema) =>
    decode(schema, { checkedAt: new Date().toISOString(), accounts: [], hubs })
  const input = {
    profile,
    cache,
    read,
    refresh,
    force: false,
    kind: 'limits' as const,
    publish: () => {},
    publishHubs,
  }
  await refreshUsageEntry({ ...input, connected: true })
  expect(publishHubs).toHaveBeenLastCalledWith(hubs)
  publishHubs.mockClear()
  await refreshUsageEntry({ ...input, connected: false })
  expect(publishHubs).toHaveBeenCalledExactlyOnceWith(hubs)
  await refreshUsageEntry({
    ...input,
    connected: true,
    read: async (_, __, ___, schema) =>
      decode(schema, { checkedAt: new Date().toISOString(), accounts: [] }),
  })
  expect(publishHubs).toHaveBeenLastCalledWith([])
})

it('publishes hub readings while a local provider is blocked, and refreshes local state without waiting for hubs', async () => {
  for (const blocked of ['local', 'hubs']) {
    const { profile, cache } = fixture()
    let release: (value: unknown) => void = () => {},
      published: () => void = () => {}
    const gate = new Promise<unknown>((resolve) => (release = resolve))
    const visible = new Promise<void>((resolve) => (published = resolve))
    const hubs = [{ id: 'hub', label: 'Hub', url: 'http://hub/', enabled: true, limits: [] }]
    const read: UsageRead = async (_, __, input, schema) => {
      const section = decodeSections(input)
      if (section === blocked) await gate
      return decode(schema, {
        checkedAt: new Date().toISOString(),
        accounts: [],
        ...(section === 'hubs' ? { hubs } : {}),
      })
    }
    const pending = refreshUsageEntry({
      profile,
      cache,
      read,
      kind: 'limits',
      force: false,
      connected: true,
      publish: () => {},
      publishHubs: () => {
        if (blocked === 'local') published()
      },
      refresh: async () => {
        if (blocked === 'hubs') published()
      },
    })
    await visible
    release(undefined)
    expect(await pending).toEqual([])
  }
})
function decodeSections(input: unknown) {
  return input && typeof input === 'object' && 'section' in input ? input.section : undefined
}

it('marks cached hub account health unavailable on a transport failure without deleting the last safe cache', async () => {
  const { profile, cache } = fixture()
  const hubs: UsageHub[] = [
    {
      id: 'hub',
      label: 'Hub',
      url: 'http://hub/',
      enabled: true,
      limits: [],
      accounts: [
        {
          id: 'auth',
          provider: 'codex',
          account: { id: 'account', label: 'Account' },
          status: 'ok',
        },
      ],
    },
  ]
  await cache.write('usage-hubs', hubs)
  const publishHubs = vi.fn<(value: UsageHub[]) => void>()
  const read: UsageRead = async (_, __, input, schema) => {
    if (decodeSections(input) === 'hubs') throw new Error('Connection lost')
    return decode(schema, { checkedAt: new Date().toISOString(), accounts: [] })
  }
  const notices = await refreshUsageEntry({
    profile,
    cache,
    read,
    publishHubs,
    publish: () => {},
    refresh: async () => {},
    kind: 'limits',
    force: false,
    connected: true,
  })
  expect(notices).toContain('Connection lost')
  expect(publishHubs.mock.lastCall?.[0][0]?.accounts?.[0]?.status).toBe('failed')
  const { usageHubsSchema } = await import('../workflow/plan-limits')
  expect((await cache.read('usage-hubs', usageHubsSchema))?.value).toEqual(hubs)
})
