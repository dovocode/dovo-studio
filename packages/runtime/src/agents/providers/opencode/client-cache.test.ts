import { afterEach, expect, it, vi } from 'vite-plus/test'
import { OpenCodeClientCache } from './client-cache.js'

afterEach(() => vi.useRealTimers())

it('keeps an active run on the same client while expiring idle clients', () => {
  vi.useFakeTimers()
  const cache = new OpenCodeClientCache<object>(2, 1000)
  const active = cache.acquire('active', () => ({}))
  const idle = cache.get('idle', () => ({}))
  vi.advanceTimersByTime(1001)
  cache.get('new', () => ({}))
  expect(cache.get('active', () => ({}))).toBe(active.value)
  expect(cache.get('idle', () => ({}))).not.toBe(idle)
  active.release()
  vi.advanceTimersByTime(1001)
  expect(cache.get('active', () => ({}))).not.toBe(active.value)
})

it('shares every active client above capacity and prunes released overflow', () => {
  const cache = new OpenCodeClientCache<object>()
  const create = vi.fn<() => object>(() => ({}))
  const leases = Array.from({ length: 129 }, (_, index) =>
    cache.acquire(`endpoint-${index}`, create),
  )
  const overflow = leases[128]
  expect(cache.get('endpoint-128', create)).toBe(overflow.value)
  const concurrent = cache.acquire('endpoint-128', create)
  expect(concurrent.value).toBe(overflow.value)
  expect(create).toHaveBeenCalledTimes(129)

  leases[0].release()
  expect(cache.get('endpoint-0', create)).not.toBe(leases[0].value)
  expect(cache.get('endpoint-128', create)).toBe(overflow.value)
  for (const lease of leases) lease.release()
  // Releasing a lease twice cannot release another run's ownership of the same client.
  overflow.release()
  expect(cache.get('endpoint-128', create)).toBe(concurrent.value)
  concurrent.release()

  const replacement = cache.get('replacement', create)
  expect(cache.get('replacement', create)).toBe(replacement)
  expect(cache.get('endpoint-1', create)).not.toBe(leases[1].value)
})

it('leaves client disposal to the run owner when idle entries expire or are evicted', () => {
  vi.useFakeTimers()
  const cache = new OpenCodeClientCache<{ dispose: () => void }>(1, 1000)
  const active = cache.acquire('active', () => ({ dispose: vi.fn<() => void>() }))
  const overflow = cache.acquire('overflow', () => ({ dispose: vi.fn<() => void>() }))
  active.release()
  active.release()
  expect(active.value.dispose).not.toHaveBeenCalled()
  expect(cache.get('overflow', () => ({ dispose: vi.fn<() => void>() }))).toBe(overflow.value)
  overflow.release()
  vi.advanceTimersByTime(1001)
  cache.get('replacement', () => ({ dispose: vi.fn<() => void>() }))
  expect(overflow.value.dispose).not.toHaveBeenCalled()
})
