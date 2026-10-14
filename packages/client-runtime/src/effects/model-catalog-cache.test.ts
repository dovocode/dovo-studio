import { createHash } from 'node:crypto'
import { expect, it, vi } from 'vite-plus/test'
import { ModelCatalogCache, type ModelCatalogCacheScope } from './model-catalog-cache.js'

type Catalog = { models: { id: string; name: string }[]; private?: string }
const catalog: Catalog = {
  models: [{ id: 'model', name: 'Last good model' }],
  private: 'live-secret',
}
const safe = { models: catalog.models }
const scope = (key = 'one', presentationKey = key): ModelCatalogCacheScope => ({
  key,
  presentationKey,
})
const hash = async (value: string) => createHash('sha256').update(value).digest('hex')
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function setup() {
  let raw: string | null = null
  const storage = {
    getItem: vi.fn<() => Promise<string | null>>(async () => raw),
    setItem: vi.fn<(key: string, value: string) => Promise<void>>(async (_key, value) => {
      raw = value
    }),
  }
  const options = {
    storage,
    hash,
    decode: (value: unknown): Catalog | null => {
      if (
        !value ||
        typeof value !== 'object' ||
        !('models' in value) ||
        !Array.isArray(value.models)
      )
        return null
      const models: Catalog['models'] = []
      for (const model of value.models) {
        if (
          !model ||
          typeof model !== 'object' ||
          typeof model.id !== 'string' ||
          typeof model.name !== 'string'
        )
          return null
        models.push({ id: model.id, name: model.name })
      }
      return { models }
    },
    presentation: (value: Catalog): Catalog => ({ models: value.models }),
  }
  return { storage, options, cache: new ModelCatalogCache(options) }
}

it('single-flights before asynchronous hydration and caches nonempty live success', async () => {
  const { cache } = setup()
  const request = vi.fn<() => Promise<Catalog>>(async () => catalog)
  const first = cache.load(scope(), request)
  expect(cache.load(scope(), request)).toBe(first)
  await first
  await cache.load(scope(), request)
  expect(request).toHaveBeenCalledTimes(1)
  expect(cache.peek(scope())).toEqual(catalog)
  await cache.load(scope(), request, true)
  expect(request).toHaveBeenCalledTimes(2)
})

it('restores stale presentation across reload and runtime restart, immediately in memory and then disk', async () => {
  const { cache, options, storage } = setup()
  await cache.load(scope('boot-1', 'logical-runtime/account-private'), async () => catalog)
  expect(cache.peek(scope('boot-2', 'logical-runtime/account-private'))).toEqual(safe)
  expect(cache.isFresh(scope('boot-2', 'logical-runtime/account-private'))).toBe(false)
  await vi.waitFor(() => expect(storage.setItem).toHaveBeenCalled())
  const raw = await storage.getItem()
  expect(raw).not.toContain('account-private')
  expect(raw).not.toContain('live-secret')
  const restored = new ModelCatalogCache(options)
  await restored.ensure(scope('boot-2', 'logical-runtime/account-private'))
  expect(restored.peek(scope('boot-2', 'logical-runtime/account-private'))).toEqual(safe)
  expect(restored.isFresh(scope('boot-2', 'logical-runtime/account-private'))).toBe(false)
  const server = vi.fn<() => Promise<Catalog | null>>(async () => null)
  const live = vi.fn<() => Promise<Catalog>>(async () => catalog)
  await restored.load(scope('boot-2', 'logical-runtime/account-private'), live, false, server)
  expect(live).toHaveBeenCalledOnce()
  expect(server).not.toHaveBeenCalled()
})

it('publishes safe server metadata before discovery finishes, only when local data is missing', async () => {
  const { cache } = setup()
  const live = deferred<Catalog>()
  const cached = vi.fn<() => Promise<Catalog>>(async () => catalog)
  const listener = vi.fn<() => void>()
  cache.subscribe(listener)
  const pending = cache.load(scope(), () => live.promise, false, cached)
  await vi.waitFor(() => expect(cache.peek(scope())).toEqual(safe))
  expect(cache.isFresh(scope())).toBe(false)
  expect(listener).toHaveBeenCalledOnce()
  live.resolve(catalog)
  await pending
  await cache.load(scope(), async () => catalog, true, cached)
  expect(cached).toHaveBeenCalledOnce()
})

it.each([404, 405])('supports an old runtime cached endpoint returning %s', async (status) => {
  const { cache } = setup()
  const live = vi.fn<() => Promise<Catalog>>(async () => catalog)
  await cache.load(scope(), live, false, async () => {
    throw { status }
  })
  expect(live).toHaveBeenCalledOnce()
})

it.each([401, 403, 500])(
  'surfaces cached endpoint failures (%s) without masking them with live discovery',
  async (status) => {
    const { cache } = setup()
    const live = vi.fn<() => Promise<Catalog>>(async () => catalog)
    await expect(
      cache.load(scope(), live, false, async () => {
        throw { status }
      }),
    ).rejects.toEqual({ status })
    expect(live).not.toHaveBeenCalled()
    expect(cache.isFresh(scope())).toBe(false)
  },
)

it('retains last-good names with failed/empty discovery, strips live fields and never grants an empty/error TTL', async () => {
  const { cache } = setup()
  await cache.load(scope(), async () => catalog)
  await expect(
    cache.load(
      scope(),
      async () => {
        throw new Error('Sign in required')
      },
      true,
    ),
  ).rejects.toThrow('Sign in required')
  expect(cache.peek(scope())).toEqual(safe)
  expect(cache.isFresh(scope())).toBe(false)
  const empty = vi.fn<() => Promise<Catalog>>(async () => ({ models: [] }))
  expect(await cache.load(scope(), empty)).toEqual(safe)
  await cache.load(scope(), empty)
  expect(empty).toHaveBeenCalledTimes(2)
  expect(cache.isFresh(scope())).toBe(false)
  await cache.load(scope('empty'), empty)
  expect(cache.peek(scope('empty'))).toEqual({ models: [] })
  expect(cache.isFresh(scope('empty'))).toBe(false)
})

it('keeps newly discovered live controls even when no models are advertised, without a success TTL', async () => {
  const { cache } = setup()
  const controls = { models: [], private: 'new-live-controls' }
  await cache.load(scope(), async () => controls)
  expect(cache.peek(scope())).toEqual(controls)
  expect(cache.isFresh(scope())).toBe(false)
  await cache.load(scope(), async () => catalog)
  await cache.load(scope(), async () => controls, true)
  expect(cache.peek(scope())).toEqual({ ...controls, models: catalog.models })
  expect(cache.isFresh(scope())).toBe(false)
})

it('late previous-boot responses cannot replace the current presentation on disk or in memory', async () => {
  const { cache, options, storage } = setup()
  const old = deferred<Catalog>()
  const pending = cache.load(scope('boot-1', 'same'), () => old.promise)
  const newer = { models: [{ id: 'new', name: 'New account labels' }] }
  await cache.load(scope('boot-2', 'same'), async () => newer)
  old.resolve(catalog)
  await pending
  expect(cache.peek(scope('boot-2', 'same'))).toEqual(newer)
  expect(cache.peek(scope('boot-3', 'same'))).toEqual(newer)
  await vi.waitFor(() => expect(storage.setItem).toHaveBeenCalled())
  const restored = new ModelCatalogCache(options)
  await restored.ensure(scope('boot-3', 'same'))
  expect(restored.peek(scope('boot-3', 'same'))).toEqual(newer)
})

it('keeps account/configuration responses isolated, including late failures', async () => {
  const { cache } = setup()
  const old = deferred<Catalog>()
  const pending = cache.load(scope('account-one'), () => old.promise)
  const outcome = pending.catch((error: unknown) => error)
  await cache.load(scope('account-two'), async () => catalog)
  old.reject(new Error('old failure'))
  expect(await outcome).toEqual(new Error('old failure'))
  expect(cache.peek(scope('account-one'))).toBeNull()
  expect(cache.peek(scope('account-two'))).toEqual(catalog)
})

it('storage corruption, read/write failures and crypto errors cannot fail valid live discovery', async () => {
  const { options } = setup()
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    for (const getItem of [
      async () => '{bad',
      async () => {
        throw new Error('disk read')
      },
    ]) {
      const cache = new ModelCatalogCache({
        ...options,
        storage: {
          getItem,
          setItem: async () => {
            throw new Error('disk write')
          },
        },
      })
      expect(await cache.load(scope(), async () => catalog)).toEqual(catalog)
    }
    const cache = new ModelCatalogCache({
      ...options,
      hash: async () => {
        throw new Error('crypto')
      },
    })
    expect(await cache.load(scope(), async () => catalog)).toEqual(catalog)
    await vi.waitFor(() => expect(warn).toHaveBeenCalled())
  } finally {
    warn.mockRestore()
  }
})

it('coalesces disk writes while a slow write runs and flushes the newest bounded snapshot', async () => {
  const { options, storage } = setup()
  const firstWrite = deferred<void>()
  storage.setItem.mockImplementationOnce(() => firstWrite.promise)
  const cache = new ModelCatalogCache(options)
  await cache.load(scope('first'), async () => catalog)
  await vi.waitFor(() => expect(storage.setItem).toHaveBeenCalledOnce())
  for (let index = 0; index < 80; index++)
    await cache.load(scope(String(index)), async () => catalog)
  expect(storage.setItem).toHaveBeenCalledOnce()
  expect(cache.peek(scope('first'))).toBeNull()
  firstWrite.resolve()
  await vi.waitFor(() => expect(storage.setItem).toHaveBeenCalledTimes(2))
  const latest: unknown = JSON.parse(storage.setItem.mock.calls[1][1])
  expect(Array.isArray(latest) && latest.length).toBe(64)
  const restored = new ModelCatalogCache(options)
  await restored.ensure(scope('79'))
  expect(restored.peek(scope('79'))).toEqual(safe)
  await restored.ensure(scope('first'))
  expect(restored.peek(scope('first'))).toBeNull()
})

it('bounds retained catalog bytes and in-flight work without losing single-flight', async () => {
  const { cache, storage } = setup()
  const big = { models: [{ id: 'big', name: 'x'.repeat(180000) }] }
  for (let index = 0; index < 12; index++) await cache.load(scope(String(index)), async () => big)
  expect(cache.peek(scope('0'))).toBeNull()
  expect(cache.peek(scope('11'))).toEqual(big)
  await vi.waitFor(() => expect(storage.setItem).toHaveBeenCalled())
  expect((await storage.getItem())!.length * 2).toBeLessThan(2 * 1024 * 1024)
  const live = deferred<Catalog>()
  const running = Array.from({ length: 64 }, (_, index) =>
    cache.load(scope(`pending-${index}`), () => live.promise),
  )
  expect(cache.load(scope('pending-0'), () => live.promise)).toBe(running[0])
  await expect(cache.load(scope('overflow'), () => live.promise)).rejects.toThrow(
    'Too many model discoveries',
  )
  live.resolve(catalog)
  await Promise.all(running)
  await cache.load(scope('overflow'), async () => catalog)
  expect(cache.isFresh(scope('overflow'))).toBe(true)
})

it('exposes only safe presentation as soon as a live TTL expires, even before another load', async () => {
  const { cache } = setup()
  await cache.load(scope(), async () => catalog)
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 300001)
  try {
    expect(cache.isFresh(scope())).toBe(false)
    expect(cache.peek(scope())).toEqual(safe)
    expect(cache.peek(scope())?.private).toBeUndefined()
  } finally {
    clock.mockRestore()
  }
})
