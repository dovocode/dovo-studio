import { expect, it, vi } from 'vite-plus/test'
import { DiscoveryCache } from './discovery-cache.js'

it('shares requests and publishes results even after the initiating subscriber leaves', async () => {
  const cache = new DiscoveryCache<string[]>(30_000)
  let complete!: (value: string[]) => void
  const request = vi.fn<() => Promise<string[]>>(
    () =>
      new Promise<string[]>((resolve) => {
        complete = resolve
      }),
  )
  const listener = vi.fn<() => void>()
  const unsubscribe = cache.subscribe(listener)
  const first = cache.load('runtime/agent', request)
  expect(cache.load('runtime/agent', request)).toBe(first)
  unsubscribe()
  await Promise.resolve()
  complete(['model'])
  await first
  expect(cache.peek('runtime/agent')).toEqual(['model'])
  expect(listener).not.toHaveBeenCalled()
  await cache.load('runtime/agent', request)
  expect(request).toHaveBeenCalledTimes(1)
  expect(cache.peek('other-runtime/agent')).toBeNull()
})

it('retains stale results through background refresh and failures', async () => {
  const cache = new DiscoveryCache<string[]>(0)
  await cache.load('scope', async () => ['old'])
  expect(cache.isFresh('scope')).toBe(false)
  const refresh = cache.load('scope', async () => {
    throw new Error('Offline')
  })
  expect(cache.peek('scope')).toEqual(['old'])
  await expect(refresh).rejects.toThrow('Offline')
  expect(cache.peek('scope')).toEqual(['old'])
  await cache.load('scope', async () => ['new'])
  expect(cache.peek('scope')).toEqual(['new'])
})

it('forces fresh entries to refresh and bounds retained scopes', async () => {
  const cache = new DiscoveryCache<number>(30_000)
  await cache.load('scope', async () => 1)
  await cache.load('scope', async () => 2, true)
  expect(cache.peek('scope')).toBe(2)
  for (let index = 0; index < 64; index++) await cache.load(String(index), async () => index)
  expect(cache.peek('scope')).toBeNull()
  expect(cache.peek('63')).toBe(63)
})

it('can avoid freshness for unavailable probes and clear stale readiness on refresh failure', async () => {
  const cache = new DiscoveryCache<boolean>(30_000, {
    cacheable: (available) => available,
    retainOnError: false,
  })
  const unavailable = vi.fn<() => Promise<boolean>>(async () => false)
  await cache.load('scope', unavailable)
  await cache.load('scope', unavailable)
  expect(unavailable).toHaveBeenCalledTimes(2)
  expect(cache.isFresh('scope')).toBe(false)
  await cache.load('scope', async () => true)
  expect(cache.isFresh('scope')).toBe(true)
  await expect(
    cache.load(
      'scope',
      async () => {
        throw new Error('sign in')
      },
      true,
    ),
  ).rejects.toThrow('sign in')
  expect(cache.peek('scope')).toBeNull()
  expect(cache.isFresh('scope')).toBe(false)
})

it('optionally bounds concurrent probes while preserving single-flight and releasing capacity', async () => {
  const cache = new DiscoveryCache<number>(30_000, { maxPending: 1 })
  let complete!: (value: number) => void
  const pending = cache.load(
    'one',
    () =>
      new Promise((resolve) => {
        complete = resolve
      }),
  )
  expect(cache.load('one', async () => 0)).toBe(pending)
  await expect(cache.load('two', async () => 2)).rejects.toThrow('Too many discoveries')
  complete(1)
  await pending
  expect(await cache.load('two', async () => 2)).toBe(2)
})
