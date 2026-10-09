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
