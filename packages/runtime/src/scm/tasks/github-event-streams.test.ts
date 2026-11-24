import { afterEach, expect, it, vi } from 'vite-plus/test'
import { GithubEventStreams } from './github-event-streams.js'
import type { SourceContext } from '../forges/integration/source-context.js'

const scope: SourceContext = {
  provider: 'github',
  host: 'github.com',
  repository: 'team/project',
  readerIdentity: 'reader',
  destination: 'project',
  github: { host: 'github.com', token: 'test-token' },
  validate: () => {},
}
const url = 'https://github.com/team/project/pull/7'
const subscriptions = 'https://api.github.com/event-subscriptions'
const eventsUrl = subscriptions + '/abcdef/events'
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it('reuses the subscription after a disconnect and creates another when GitHub ends it', async () => {
  vi.useFakeTimers()
  const notify = vi.fn<(key: string) => void>()
  const manager = new GithubEventStreams(notify)
  const closed: AbortSignal[] = []
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (input === subscriptions) return Response.json({ events_url: eventsUrl })
    expect(input).toBe(eventsUrl)
    if (!init?.signal) throw new Error('missing cancellation')
    closed.push(init.signal)
    return new Response(
      closed.length === 2
        ? 'event: github.stream.end\ndata: {"outcome":"subscription_ended"}\n\n'
        : ': heartbeat\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } },
    )
  })
  const watch = () => manager.watch('one', url, 7, scope, vi.fn<(status: number) => void>())
  for (const count of [1, 2, 3]) {
    watch()
    await vi.waitFor(() => expect(closed[count - 1]?.aborted).toBe(true))
    expect(notify).toHaveBeenCalledTimes(count)
    watch()
    expect(closed).toHaveLength(count)
    await vi.advanceTimersByTimeAsync(120_000)
  }
  expect(fetch.mock.calls.map(([endpoint]) => endpoint)).toEqual([
    subscriptions,
    eventsUrl,
    eventsUrl,
    subscriptions,
    eventsUrl,
  ])
})

it('skips other hosts and mismatched repositories, and rejects off-origin stream URLs', async () => {
  const manager = new GithubEventStreams(vi.fn<(key: string) => void>())
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({
      events_url: 'https://elsewhere.example/events',
    }),
  )
  manager.watch('one', url, 7, { ...scope, host: 'enterprise.example' }, vi.fn())
  manager.watch('one', url, 7, { ...scope, repository: 'another/repo' }, vi.fn())
  expect(fetch).not.toHaveBeenCalled()
  manager.watch('one', url, 7, scope, vi.fn<(status: number) => void>())
  await vi.waitFor(() => expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true))
  expect(fetch.mock.calls.map(([endpoint]) => endpoint)).toEqual([subscriptions])
})
