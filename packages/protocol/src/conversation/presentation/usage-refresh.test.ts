import { expect, it, vi } from 'vite-plus/test'
import { decode } from '../../shared/schema.js'
import { runtimeProfile } from '../../runtime/connection/runtime-fleet.js'
import { createRuntimeReadCache, type CacheStorage } from '../../runtime/cache/read-cache.js'
import { usageHistorySchema, type UsageHistoryResult } from './usage-history.js'
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
