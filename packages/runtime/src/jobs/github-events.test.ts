import { expect, it, vi } from 'vite-plus/test'
import { defaultGithubTrigger, githubEventChoices, type GithubTrigger } from '@dovo/protocol'
import { GithubEvents } from './github-events.js'
const since = '2026-10-04T09:00:00Z',
  until = '2026-10-04T09:01:00Z'
const item = {
  id: 'item',
  number: 42,
  title: 'Test',
  body: 'Context',
  url: 'https://github.com/team/project/issues/42',
  createdAt: '2026-10-04T09:00:30Z',
  updatedAt: '2026-10-04T09:00:40Z',
  author: { login: 'octocat' },
  headRefOid: 'after',
  state: 'OPEN',
  lastEditedAt: '2026-10-04T09:00:35Z',
  editor: { login: 'editor' },
}
const page = (nodes: unknown[], cursor: string | null = null) => ({
  nodes,
  pageInfo: { hasNextPage: !!cursor, endCursor: cursor },
})
function client(response: (args: string[]) => unknown) {
  const githubAccount = vi.fn<(args: string[]) => Promise<string>>(async (args: string[]) =>
    JSON.stringify(response(args)),
  )
  return { events: new GithubEvents({ githubAccount }), githubAccount }
}
function config(event: GithubTrigger['event']): GithubTrigger {
  return { ...defaultGithubTrigger, repository: 'team/project', event }
}
it.each(githubEventChoices.map((choice) => choice.id))(
  'collects %s with event and item context',
  async (event) => {
    const f = client((args) => {
      const query = args.find((arg) => arg.startsWith('query=')) ?? ''
      if (query.includes('items:')) return { data: { repository: { items: page([item]) } } }
      if (query.includes('timelineItems'))
        return {
          data: {
            node: {
              timelineItems: page([
                {
                  __typename: 'Event',
                  id: 'event',
                  createdAt: item.createdAt,
                  submittedAt: item.createdAt,
                  actor: { login: 'octocat' },
                  body: 'Details',
                },
              ]),
            },
          },
        }
      if (query.includes('replies')) return { data: { node: { replies: page([]) } } }
      if (query.includes('comments'))
        return { data: { node: { comments: page([{ ...item, id: 'comment' }]) } } }
      if (args.some((arg) => arg.includes('/comments?')))
        return [
          {
            id: 123,
            created_at: item.createdAt,
            user: { login: 'octocat' },
            body: 'Review',
            html_url: item.url,
            path: 'app.ts',
          },
        ]
      throw new Error(`Unexpected request: ${args.join(' ')}`)
    })
    const result = await f.events.collect(config(event), since, until, { item: 'before' })
    expect(result.deliveries).toHaveLength(1)
    expect(result.deliveries[0]).toMatchObject({
      event,
      context: { repository: 'github.com/team/project', item: { title: 'Test', body: 'Context' } },
    })
    expect(f.githubAccount.mock.calls[0][0]).toContain('--hostname')
  },
)
it('paginates items and timelines and excludes old or future events', async () => {
  const f = client((args) => {
    const query = args.find((arg) => arg.startsWith('query=')) ?? ''
    if (query.includes('items:'))
      return {
        data: {
          repository: {
            items: query.includes('after:null')
              ? page([item], 'items-next')
              : page([{ ...item, id: 'older', updatedAt: '2026-10-03T00:00:00Z' }]),
          },
        },
      }
    return {
      data: {
        node: {
          timelineItems: query.includes('after:null')
            ? page(
                [{ __typename: 'IssueComment', id: 'old', createdAt: '2026-10-03T00:00:00Z' }],
                'timeline-next',
              )
            : page([
                {
                  __typename: 'IssueComment',
                  id: 'current',
                  createdAt: item.createdAt,
                  author: item.author,
                },
                { __typename: 'IssueComment', id: 'future', createdAt: '2026-10-05T00:00:00Z' },
              ]),
        },
      },
    }
  })
  expect(
    (await f.events.collect(config('issue.comment'), since, until, {})).deliveries.map(
      (event) => event.id,
    ),
  ).toEqual(['current'])
  expect(f.githubAccount).toHaveBeenCalledTimes(4)
})
it('filters labels and actors and checks the event actor’s write access', async () => {
  const f = client((args) => {
    const query = args.find((arg) => arg.startsWith('query=')) ?? ''
    if (query.includes('items:')) return { data: { repository: { items: page([item]) } } }
    if (query.includes('labels')) return { data: { node: { labels: page([{ name: 'bug' }]) } } }
    if (args.some((arg) => arg.endsWith('/permission'))) return { permission: 'read' }
    throw new Error('Unexpected query')
  })
  const c = { ...config('issue.created'), label: 'bug', actor: 'OCTOCAT', requireWriteAccess: true }
  expect((await f.events.collect(c, since, until, {})).deliveries).toEqual([])
  c.requireWriteAccess = false
  expect((await f.events.collect(c, since, until, {})).deliveries).toHaveLength(1)
  c.label = 'other'
  expect((await f.events.collect(c, since, until, {})).deliveries).toEqual([])
  c.label = 'bug'
  c.actor = 'someone'
  expect((await f.events.collect(c, since, until, {})).deliveries).toEqual([])
})
it('baselines older PR heads without triggering, then detects a changed head', async () => {
  const old = { ...item, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }
  const f = client(() => ({ data: { repository: { items: page([old]) } } }))
  const c = config('pull_request.synchronized')
  const first = await f.events.collect(c, since, until, {})
  expect(first.deliveries).toEqual([])
  expect(first.heads).toEqual({ item: 'after' })
  const changed = client(() => ({ data: { repository: { items: page([item]) } } }))
  const result = await changed.events.collect(c, since, until, { item: 'before' })
  expect(result.deliveries[0].context.detail).toEqual({ before: 'before', after: 'after' })
})
it('fails on GraphQL errors and malformed boundary data instead of accepting partial results', async () => {
  const error = client(() => ({
    data: { repository: { items: page([item]) } },
    errors: [{ message: 'No access' }],
  }))
  await expect(error.events.collect(config('issue.created'), since, until, {})).rejects.toThrow(
    'No access',
  )
  const invalid = client(() => ({ data: { repository: { items: page([{ id: 'invalid' }]) } } }))
  await expect(invalid.events.collect(config('issue.created'), since, until, {})).rejects.toThrow(
    /Invalid input/,
  )
})

it('distinguishes repeated head transitions and records heads even when a label filters the event', async () => {
  const f = client((args) => {
    const query = args.find((arg) => arg.startsWith('query=')) ?? ''
    if (query.includes('labels')) return { data: { node: { labels: page([]) } } }
    return { data: { repository: { items: page([item]) } } }
  })
  const c = config('pull_request.synchronized')
  const first = await f.events.collect(c, since, until, { item: 'before' })
  const later = await f.events.collect(c, since, '2026-10-04T09:02:00Z', { item: 'before' })
  expect(first.deliveries[0].id).not.toBe(later.deliveries[0].id)
  c.label = 'bug'
  const filtered = await f.events.collect(c, since, until, { item: 'before' })
  expect(filtered.deliveries).toEqual([])
  expect(filtered.heads).toEqual({ item: 'after' })
})
it('stops between requests when the runtime shuts down', async () => {
  let resolve!: (data: string) => void
  const githubAccount = vi.fn<() => Promise<string>>(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const events = new GithubEvents({ githubAccount })
  const collection = events.collect(config('issue.comment'), since, until, {})
  events.dispose()
  resolve(JSON.stringify({ data: { repository: { items: page([item]) } } }))
  await expect(collection).rejects.toThrow('GitHub polling stopped')
  expect(githubAccount).toHaveBeenCalledTimes(1)
})

it('removes closed PRs from synchronization snapshots', async () => {
  const f = client(() => ({
    data: { repository: { items: page([{ ...item, state: 'MERGED' }]) } },
  }))
  const result = await f.events.collect(config('pull_request.synchronized'), since, until, {
    item: 'before',
  })
  expect(result.deliveries).toEqual([])
  expect(result.heads).toEqual({})
})
