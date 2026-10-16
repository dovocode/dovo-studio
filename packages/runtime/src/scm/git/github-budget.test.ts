import { afterEach, expect, it, vi } from 'vite-plus/test'
import { GithubBudget } from './github-budget'
import { GithubApiError } from './github-transport'

afterEach(() => vi.useRealTimers())
it('stops core reads and writes for an exhausted account until its actual reset, without blocking another account', async () => {
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
it('pauses background refreshes below the reserve while interactive calls continue', async () => {
  vi.useFakeTimers()
  const budget = new GithubBudget()
  const quota = vi.fn<() => Promise<string>>(async () => '{}')
  const resetAt = new Date(Date.now() + 600_000).toISOString()
  budget.observeGraphql(
    'account',
    JSON.stringify({ data: { rateLimit: { limit: 5000, remaining: 400, resetAt } } }),
  )
  await expect(
    budget.run('account', async () => 'refreshed', quota, {
      background: true,
      resource: 'graphql',
    }),
  ).rejects.toMatchObject({ status: 429 })
  await expect(budget.run('account', async () => 'ready', quota)).resolves.toBe('ready')
  // An older window's reading never hides the current balance.
  budget.observeGraphql(
    'account',
    JSON.stringify({
      data: { rateLimit: { limit: 5000, remaining: 4000, resetAt: new Date(0).toISOString() } },
    }),
  )
  await expect(
    budget.run('account', async () => 'refreshed', quota, {
      background: true,
      resource: 'graphql',
    }),
  ).rejects.toMatchObject({ status: 429 })
  budget.observeGraphql(
    'account',
    JSON.stringify({
      data: {
        rateLimit: {
          limit: 5000,
          remaining: 4000,
          resetAt: new Date(Date.parse(resetAt) + 3600000).toISOString(),
        },
      },
    }),
  )
  await expect(
    budget.run('account', async () => 'refreshed', quota, {
      background: true,
      resource: 'graphql',
    }),
  ).resolves.toBe('refreshed')
  budget.observeGraphql('account', 'not json')
  expect(quota).not.toHaveBeenCalled()
})

it.each(['core', 'graphql'])(
  'isolates the %s primary quota and uses its exact reset, ignoring other exhausted buckets',
  async (resource) => {
    vi.useFakeTimers()
    const budget = new GithubBudget()
    const reset = Math.floor(Date.now() / 1000) + 10
    const quota = vi.fn<() => Promise<string>>(async () =>
      JSON.stringify({
        resources: {
          [resource]: { remaining: 0, reset },
          [resource === 'core' ? 'graphql' : 'core']: { remaining: 0, reset: reset + 3600 },
        },
      }),
    )
    await expect(
      budget.run(
        'account',
        async () => {
          throw new Error('API rate limit exceeded')
        },
        quota,
        { resource },
      ),
    ).rejects.toMatchObject({ status: 429 })
    await expect(
      budget.run('account', async () => 'REST or GraphQL still available', quota, {
        resource: resource === 'core' ? 'graphql' : 'core',
      }),
    ).resolves.toContain('available')
    await vi.advanceTimersByTimeAsync(10_001)
    await expect(budget.run('account', async () => 'ready', quota, { resource })).resolves.toBe(
      'ready',
    )
  },
)
it('uses authoritative response resets without a probe, and recovers unknown primary limits after a minute', async () => {
  vi.useFakeTimers()
  const budget = new GithubBudget()
  const quota = vi.fn<() => Promise<string>>(async () => '{}')
  await expect(
    budget.run(
      'account',
      async () => {
        throw new GithubApiError(403, 'GitHub rate limit', undefined, {
          secondary: false,
          resource: 'graphql',
          resetAt: Date.now() + 5000,
        })
      },
      quota,
      { resource: 'graphql' },
    ),
  ).rejects.toMatchObject({ status: 429 })
  expect(quota).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(5001)
  await expect(
    budget.run('account', async () => 'ready', quota, { resource: 'graphql' }),
  ).resolves.toBe('ready')
  await expect(
    budget.run(
      'account',
      async () => {
        throw new Error('rate limit exceeded')
      },
      quota,
    ),
  ).rejects.toMatchObject({ status: 429 })
  await vi.advanceTimersByTimeAsync(60001)
  await expect(budget.run('account', async () => 'ready', quota)).resolves.toBe('ready')
})
it('keeps secondary cooldowns shared across resources and honors short retry-after values', async () => {
  vi.useFakeTimers()
  const budget = new GithubBudget()
  const quota = vi.fn<() => Promise<string>>(async () => '{}')
  await expect(
    budget.run(
      'account',
      async () => {
        throw new Error('secondary rate limit, retry-after: 2')
      },
      quota,
      { resource: 'graphql' },
    ),
  ).rejects.toMatchObject({ status: 429 })
  await expect(budget.run('account', async () => 'ready', quota)).rejects.toMatchObject({
    status: 429,
  })
  await vi.advanceTimersByTimeAsync(2001)
  await expect(budget.run('account', async () => 'ready', quota)).resolves.toBe('ready')
  expect(quota).not.toHaveBeenCalled()
})
it('tracks REST reserves and ignores out-of-order readings without pausing GraphQL', async () => {
  const budget = new GithubBudget()
  const quota = vi.fn<() => Promise<string>>(async () => '{}')
  const resetAt = Date.now() + 60000
  budget.observe('account', { limit: 5000, remaining: 100, resetAt }, 'core')
  budget.observe('account', { limit: 5000, remaining: 4000, resetAt }, 'core')
  await expect(
    budget.run('account', async () => 'ready', quota, { background: true }),
  ).rejects.toMatchObject({ status: 429 })
  await expect(
    budget.run('account', async () => 'ready', quota, { background: true, resource: 'graphql' }),
  ).resolves.toBe('ready')
  budget.observe('account', { limit: 5000, remaining: 5000, resetAt: resetAt + 3600000 }, 'core')
  await expect(
    budget.run('account', async () => 'ready', quota, { background: true }),
  ).resolves.toBe('ready')
})
