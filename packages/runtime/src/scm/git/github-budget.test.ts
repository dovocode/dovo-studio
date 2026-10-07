import { afterEach, expect, it, vi } from 'vite-plus/test'
import { GithubBudget } from './github-budget'

afterEach(() => vi.useRealTimers())
it('stops all reads and writes for an exhausted account until its actual reset, without blocking another account', async () => {
  vi.useFakeTimers()
  const budget = new GithubBudget()
  const reset = Math.floor(Date.now() / 1000) + 120
  const request = vi.fn<() => Promise<string>>(async () => {
    throw new Error('API rate limit exceeded (HTTP 403)')
  })
  const quota = vi.fn<() => Promise<string>>(async () =>
    JSON.stringify({
      resources: { core: { remaining: 0, reset }, graphql: { remaining: 12, reset } },
    }),
  )
  await expect(budget.run('account', request, quota)).rejects.toMatchObject({ status: 429 })
  await expect(budget.run('account', request, quota)).rejects.toMatchObject({ status: 429 })
  expect(request).toHaveBeenCalledTimes(1)
  expect(quota).toHaveBeenCalledTimes(1)
  await expect(budget.run('other', async () => 'ready', quota)).resolves.toBe('ready')
  await vi.advanceTimersByTimeAsync(121_000)
  await expect(budget.run('account', async () => 'ready', quota)).resolves.toBe('ready')
})
it('honors secondary retry-after and does not probe or retry the API during the cooldown', async () => {
  vi.useFakeTimers()
  const budget = new GithubBudget()
  const request = vi.fn<() => Promise<string>>(async () => {
    throw new Error('secondary rate limit, Retry-After: 90')
  })
  const quota = vi.fn<() => Promise<string>>(async () => '{}')
  await expect(budget.run('account', request, quota)).rejects.toMatchObject({ status: 429 })
  await vi.advanceTimersByTimeAsync(60_000)
  await expect(budget.run('account', request, quota)).rejects.toMatchObject({ status: 429 })
  expect(request).toHaveBeenCalledTimes(1)
  expect(quota).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(31_000)
  await expect(budget.run('account', async () => 'ready', quota)).resolves.toBe('ready')
})
it('admits at most four concurrent calls and rejects queued work after a rate limit', async () => {
  const budget = new GithubBudget()
  let release: () => void = () => {}
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const request = vi.fn<() => Promise<string>>(async () => {
    await pending
    throw new Error('secondary rate limit')
  })
  const quota = vi.fn<() => Promise<string>>(async () => '{}')
  const calls = Array.from({ length: 8 }, () => budget.run('account', request, quota))
  expect(request).toHaveBeenCalledTimes(4)
  release()
  const results = await Promise.allSettled(calls)
  expect(results.every((result) => result.status === 'rejected')).toBe(true)
  expect(request).toHaveBeenCalledTimes(4)
})
it('does not treat permissions or network errors as account exhaustion', async () => {
  const budget = new GithubBudget()
  const quota = vi.fn<() => Promise<string>>(async () => '{}')
  await expect(
    budget.run(
      'account',
      async () => {
        throw new Error('HTTP 403 forbidden')
      },
      quota,
    ),
  ).rejects.toThrow('forbidden')
  await expect(budget.run('account', async () => 'ready', quota)).resolves.toBe('ready')
  expect(quota).not.toHaveBeenCalled()
})
