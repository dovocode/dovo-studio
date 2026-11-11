import { afterEach, expect, it, vi } from 'vite-plus/test'
import { ConditionalReadCache, type ConditionalReadReply } from './conditional-read-cache'

afterEach(() => vi.useRealTimers())
it('shares simultaneous reads and keeps object identity on a matching unchanged reply', async () => {
  vi.useFakeTimers()
  const cache = new ConditionalReadCache<{ title: string }>()
  const value = { title: 'Saved PR' }
  const request = vi.fn<(version?: string) => Promise<ConditionalReadReply<{ title: string }>>>(
    async (version) => (version ? { unchanged: true as const, version } : { value, version: 'v1' }),
  )
  const [first, second] = await Promise.all([
    cache.read('account/repo/pr', request),
    cache.read('account/repo/pr', request),
  ])
  expect(first).toBe(second)
  expect(request).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1001)
  expect(await cache.read('account/repo/pr', request)).toBe(first)
  expect(request).toHaveBeenLastCalledWith('v1')
})
it('coalesces one explicit refresh after an in-flight older read, without losing refresh intent', async () => {
  const cache = new ConditionalReadCache<string>()
  let release!: (value: { value: string; version: string }) => void
  const slow = vi.fn<() => Promise<{ value: string; version: string }>>(
    () =>
      new Promise<{ value: string; version: string }>((resolve) => {
        release = resolve
      }),
  )
  const initial = cache.read('pr', slow)
  await Promise.resolve()
  const fresh = vi.fn<() => Promise<ConditionalReadReply<string>>>(async () => ({
    value: 'latest',
    version: 'v2',
  }))
  const refreshes = [cache.read('pr', fresh, true), cache.read('pr', fresh, true)]
  release({ value: 'previous', version: 'v1' })
  expect(await initial).toBe('previous')
  expect(await Promise.all(refreshes)).toEqual(['latest', 'latest'])
  expect(fresh).toHaveBeenCalledTimes(1)
  expect(await cache.read('pr', fresh)).toBe('latest')
})
it('never accepts an unchanged response without its exact baseline and does not cache errors', async () => {
  const cache = new ConditionalReadCache<string>()
  await expect(cache.read('pr', async () => ({ unchanged: true, version: 'v1' }))).rejects.toThrow(
    /baseline/,
  )
  expect(await cache.read('pr', async () => ({ value: 'old', version: 'v1' }))).toBe('old')
  await expect(
    cache.read('pr', async () => ({ unchanged: true, version: 'wrong' }), true),
  ).rejects.toThrow(/baseline/)
  await expect(
    cache.read(
      'pr',
      async () => {
        throw new Error('Account unavailable')
      },
      true,
    ),
  ).rejects.toThrow('Account unavailable')
  expect(await cache.read('pr', async () => ({ value: 'recovered', version: 'v2' }), true)).toBe(
    'recovered',
  )
})
it('bounds retained bytes and never sends a version for an evicted or different account key', async () => {
  const cache = new ConditionalReadCache<string>(100)
  const request = vi.fn<(version?: string) => Promise<ConditionalReadReply<string>>>(async () => ({
    value: 'x'.repeat(30),
    version: 'v1',
  }))
  await cache.read('account-1', request)
  await cache.read('account-2', request)
  await cache.read('account-1', request)
  expect(request.mock.calls).toEqual([[undefined], [undefined], [undefined]])
})

it('shares an in-flight legacy read but revalidates it on the next open', async () => {
  const cache = new ConditionalReadCache<string>()
  const request = vi.fn<() => Promise<ConditionalReadReply<string>>>(async () => ({
    value: 'legacy',
  }))
  await Promise.all([cache.read('pr', request), cache.read('pr', request)])
  expect(request).toHaveBeenCalledTimes(1)
  await cache.read('pr', request)
  expect(request).toHaveBeenCalledTimes(2)
})
