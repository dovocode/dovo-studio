import { expect, it, vi } from 'vite-plus/test'
import { Effect, Schema } from 'effect'
import { guardSource } from '../../../runtime/src/scm/forges/integration/source-context'
import {
  decode,
  forgeIssueSchema,
  forgeWorkOptionsSchema,
  forgeWorkQuerySchema,
  runtimeProfile,
  RuntimeRequestError,
  type RuntimeReadCache,
} from '@dovo/protocol'
import { recheckSourceReader } from '../connections/source-readers'
import type { WorkSource } from './work-sources'
import {
  cachedWorkIssuePageSchema,
  loadWorkSourcePage,
  workPageCacheValue,
  workSourceCacheKey,
} from './work-source-page'

const options = decode(forgeWorkOptionsSchema, {
  provider: 'jira',
  issues: true,
  pipelines: false,
  pipelineActions: [],
  issueSearch: true,
})
const cache: RuntimeReadCache = {
  closed: false,
  readEffect: () => Effect.succeed(null),
  writeEffect: () => Effect.void,
  removeEffect: () => Effect.void,
  clearEffect: () => Effect.void,
  closeEffect: () => Effect.void,
  read: async () => null,
  write: async () => {},
  remove: async () => {},
  clear: async () => {},
  close: async () => {},
}
const issue = (id: number, state = 'Waiting for review') =>
  decode(forgeIssueSchema, {
    id: `TEAM-${id}`,
    title: `Issue ${id}`,
    body: '',
    state,
    url: `https://team.atlassian.net/browse/TEAM-${id}`,
    author: '',
    assignees: [],
    labels: [],
    updatedAt: '',
    revision: '',
  })
// Live identity verification is shared per source scope, so each fixture is its own source.
let fixtures = 0
function fixture(response: (input: unknown) => unknown) {
  const calls: { path: string; input: unknown }[] = []
  const identity = { readerIdentity: 'jira-account', destination: 'jira-destination' }
  const profile = runtimeProfile(
    { address: 'http://mac.local:51464', token: 'paired-fixture-token' },
    'Mac',
  )
  const requestEffect: WorkSource['requestEffect'] = (path, input, schema) =>
    Effect.try({
      try: () => {
        calls.push({ path, input })
        return decode(
          schema,
          path === '/api/scm/source/identity'
            ? identity
            : path.endsWith('/options')
              ? options
              : response(input),
        )
      },
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    })
  const source = {
    key: 'mac-jira-tracker',
    scope: `mac-jira-tracker-v1-${++fixtures}`,
    name: 'Team backlog',
    runtimeId: profile.id,
    runtimeName: 'Mac',
    profile,
    connected: true,
    input: { jiraSourceId: 'tracker' },
    jira: {
      id: 'tracker',
      site: 'https://team.atlassian.net',
      project: 'TEAM',
      name: 'Team backlog',
    },
    readCache: cache,
    requestEffect,
    request: (path, input, schema) => Effect.runPromise(requestEffect(path, input, schema)),
  } satisfies WorkSource
  return { source: { ...source, reader: source }, calls, identity }
}

it('queries Jira before pagination so an older open issue with a custom status is discoverable', async () => {
  const recentDone = Array.from({ length: 40 }, (_, i) => issue(i + 1, 'Released'))
  const olderOpen = issue(99)
  const { source, calls } = fixture((input) => {
    const query = decode(forgeWorkQuerySchema, input)
    const items = query.state === 'open' ? [olderOpen] : [...recentDone, olderOpen]
    return { items: items.slice(0, 30), next: items.length > 30 ? '30' : undefined }
  })
  const all = await Effect.runPromise(loadWorkSourcePage(source, 'issues', '', 'all', false))
  expect(all.items).not.toContainEqual(olderOpen)
  const open = await Effect.runPromise(loadWorkSourcePage(source, 'issues', '', 'open', false))
  expect(open.items).toEqual([olderOpen])
  expect(calls.filter((call) => call.path.endsWith('/list')).at(-1)).toMatchObject({
    input: { jiraSourceId: 'tracker', state: 'open' },
  })
})

it('keeps loaded depth, filters and server order during a forced refresh and replaces duplicates', async () => {
  const { source, calls } = fixture((input) => {
    const query = decode(forgeWorkQuerySchema, input)
    return query.cursor
      ? { items: [{ ...issue(2), title: 'Updated duplicate' }, issue(3)], next: '60' }
      : { items: [issue(1), issue(2)], next: '30' }
  })
  const refreshed = await Effect.runPromise(
    loadWorkSourcePage(source, 'issues', 'triage', 'open', true, {
      source,
      reader: source.reader,
      loadedPages: 2,
      items: [issue(1), issue(2), issue(3)],
      options,
      optionsMode: 'issues',
      optionsFetchedAt: Date.now(),
      stale: true,
    }),
  )
  expect(refreshed.items.map((item) => item.id)).toEqual(['TEAM-1', 'TEAM-2', 'TEAM-3'])
  expect(refreshed.items[1]?.title).toBe('Updated duplicate')
  expect(refreshed).toMatchObject({ loadedPages: 2, next: '60', query: 'triage' })
  expect(refreshed.stale).toBeFalsy()
  expect(calls).toEqual([
    { path: '/api/scm/source/identity', input: { jiraSourceId: 'tracker' } },
    {
      path: '/api/scm/work/issues/list',
      input: {
        jiraSourceId: 'tracker',
        conditional: true,
        knownVersion: undefined,
        expectedReaderIdentity: 'jira-account',
        expectedDestination: 'jira-destination',
        state: 'open',
        query: 'triage',
        cursor: undefined,
        refresh: true,
      },
    },
    {
      path: '/api/scm/work/issues/list',
      input: {
        jiraSourceId: 'tracker',
        conditional: true,
        knownVersion: undefined,
        expectedReaderIdentity: 'jira-account',
        expectedDestination: 'jira-destination',
        state: 'open',
        query: 'triage',
        cursor: '30',
        refresh: true,
      },
    },
    {
      path: '/api/scm/work/options',
      input: {
        jiraSourceId: 'tracker',
        conditional: true,
        knownVersion: undefined,
        area: 'issues',
        refresh: true,
        expectedReaderIdentity: 'jira-account',
        expectedDestination: 'jira-destination',
      },
    },
  ])
})

it('retains pagination depth in saved pages and separates query and state caches', async () => {
  const { source, calls } = fixture((input) => ({
    items: [issue(decode(forgeWorkQuerySchema, input).cursor ? 2 : 1)],
    next: decode(forgeWorkQuerySchema, input).cursor ? undefined : '30',
  }))
  const saved = decode(cachedWorkIssuePageSchema, {
    items: [issue(1), issue(2)],
    loadedPages: 2,
    next: '60',
  })
  const refreshed = await Effect.runPromise(
    loadWorkSourcePage(source, 'issues', '', 'closed', false, {
      ...saved,
      source,
      reader: source.reader,
    }),
  )
  expect(refreshed.loadedPages).toBe(2)
  expect(calls.filter((call) => call.path.endsWith('/list'))).toHaveLength(2)
  const runtimePage = { ...refreshed, source }
  const cacheValue = workPageCacheValue(runtimePage)
  expect(decode(cachedWorkIssuePageSchema, cacheValue).loadedPages).toBe(2)
  expect(JSON.stringify(cacheValue)).not.toContain('paired-fixture-token')
  expect(cacheValue).not.toHaveProperty('source')
  expect(cacheValue).not.toHaveProperty('options')
  const keys = ['open', 'closed', 'all'].map((state) =>
    workSourceCacheKey(source, 'issues', 'list', '', state),
  )
  expect(new Set(keys).size).toBe(3)
  expect(workSourceCacheKey(source, 'issues', 'list', 'triage', 'open')).not.toBe(keys[0])
  expect(workSourceCacheKey(source, 'issues', 'list', '', 'open')).not.toBe(
    workSourceCacheKey(
      { ...source, jira: { ...source.jira, site: 'https://other.atlassian.net' } },
      'issues',
      'list',
      '',
      'open',
    ),
  )
})

it('reports partial freshness and stops when the source has fewer pages than before', async () => {
  const { source } = fixture(() => ({
    items: [issue(1)],
    cachedAt: '2026-10-04T12:00:00.000Z',
    stale: true,
    refreshError: 'Jira is unavailable',
  }))
  const page = await Effect.runPromise(
    loadWorkSourcePage(source, 'issues', '', 'all', true, {
      source,
      reader: source.reader,
      items: [issue(1), issue(2)],
      loadedPages: 3,
    }),
  )
  expect(page).toMatchObject({
    items: [issue(1)],
    loadedPages: 1,
    stale: true,
    error: 'Jira is unavailable',
    cachedAt: '2026-10-04T12:00:00.000Z',
  })
})

it('reads refreshed pages through an alternate Jira source while retaining origin destinations', async () => {
  const { source, calls } = fixture((input) => ({
    items: [
      {
        ...issue(decode(forgeWorkQuerySchema, input).cursor ? 2 : 1),
        destination: 'jira-destination',
      },
    ],
    next: decode(forgeWorkQuerySchema, input).cursor ? undefined : '30',
  }))
  const reader = {
    ...source,
    key: 'alternate-jira',
    scope: 'alternate-jira',
    input: { jiraSourceId: 'alternate-tracker' },
    readerIdentity: 'jira-account',
  }
  const listSource = { ...source, reader, destination: 'original-destination' }
  const page = await Effect.runPromise(
    loadWorkSourcePage(listSource, 'issues', 'triage', 'open', true, {
      source,
      reader: source,
      items: [],
      loadedPages: 2,
    }),
  )
  expect(page.items.map((item) => [item.id, item.destination])).toEqual([
    ['TEAM-1', 'original-destination'],
    ['TEAM-2', 'original-destination'],
  ])
  expect(page.options?.destination).toBe('original-destination')
  expect(calls.filter((call) => !call.path.endsWith('/identity'))).toHaveLength(3)
  for (const call of calls.filter((call) => !call.path.endsWith('/identity')))
    expect(call.input).toMatchObject({
      jiraSourceId: 'alternate-tracker',
      expectedDestination: 'jira-destination',
      expectedReaderIdentity: 'jira-account',
    })
  expect(source.input).toEqual({ jiraSourceId: 'tracker' })
  expect(
    workPageCacheValue(page).items.every((item) => item.destination === 'original-destination'),
  ).toBe(true)
})

it('keeps Jira filters on every refreshed page and separates offline cache entries', async () => {
  const { source, calls } = fixture((input) => {
    const query = decode(forgeWorkQuerySchema, input)
    return { items: [issue(query.cursor ? 2 : 1)], next: query.cursor ? undefined : '30' }
  })
  const filters = { assignee: 'mine', label: 'needs-review', orderBy: 'rank' } as const
  const page = await Effect.runPromise(
    loadWorkSourcePage(
      source,
      'issues',
      '',
      'open',
      true,
      { source, reader: source.reader, items: [], loadedPages: 2 },
      filters,
    ),
  )
  expect(page.items.map((item) => item.id)).toEqual(['TEAM-1', 'TEAM-2'])
  const lists = calls.filter((call) => call.path.endsWith('/issues/list'))
  expect(lists).toHaveLength(2)
  for (const call of lists) expect(call.input).toMatchObject({ jiraFilters: filters })
  expect(workSourceCacheKey(source, 'issues', 'list', '', 'open', filters)).not.toBe(
    workSourceCacheKey(source, 'issues', 'list', '', 'open'),
  )
  expect(workSourceCacheKey(source, 'issues', 'list', '', 'open', filters)).not.toBe(
    workSourceCacheKey(source, 'issues', 'list', '', 'open', { assignee: 'unassigned' }),
  )
})

it('treats a label named all as an active cache filter, and normalizes assignment defaults', () => {
  const { source } = fixture(() => ({ items: [] }))
  const key = (filters?: import('@dovo/protocol').JiraIssueFilters) =>
    workSourceCacheKey(source, 'issues', 'list', '', 'open', filters)
  expect(key({ label: 'all' })).not.toBe(key())
  expect(key({ orderBy: 'rank' })).not.toBe(key({ orderBy: 'updated' }))
  expect(key({ orderBy: 'title' })).not.toBe(key({ orderBy: 'rank' }))
  expect(key({ assignee: 'all' })).toBe(key())
  expect(key({ label: 'release', assignee: 'mine' })).toBe(
    key({ assignee: 'mine', label: 'release' }),
  )
})

for (const change of ['destination', 'readerIdentity'] as const) {
  it(`rejects a ${change} race on a later page before provider access`, async () => {
    const { source, calls } = fixture(() => ({ items: [issue(1)], next: 'page-2' }))
    const rawRead = source.reader.requestEffect
    const identity = { readerIdentity: 'jira-account', destination: 'jira-destination' }
    const guardSchema = Schema.Struct({
      expectedDestination: Schema.optional(Schema.String),
      expectedReaderIdentity: Schema.optional(Schema.String),
    })
    let requests = 0
    source.reader.requestEffect = (path, input, schema) =>
      Effect.gen(function* () {
        if (!path.endsWith('/identity')) {
          requests++
          if (requests === 2) identity[change] = 'changed'
          yield* Effect.try({
            try: () => guardSource(identity, decode(guardSchema, input)),
            catch: (error) => (error instanceof Error ? error : new Error(String(error))),
          })
        }
        return yield* rawRead(path, input, schema)
      })
    await expect(
      Effect.runPromise(
        loadWorkSourcePage(source, 'issues', '', 'open', true, {
          source,
          reader: source.reader,
          items: [],
          loadedPages: 2,
        }),
      ),
    ).rejects.toThrow(/changed/)
    expect(calls.filter((call) => call.path.endsWith('/list'))).toHaveLength(1)
  })
}

it('reuses the live-verified Jira account for later reads without another identity lookup', async () => {
  const { source, calls } = fixture(() => ({ items: [issue(1)] }))
  await Effect.runPromise(loadWorkSourcePage(source, 'issues', '', 'open', false))
  await Effect.runPromise(loadWorkSourcePage(source, 'issues', '', 'open', true))
  expect(calls.filter((call) => call.path.endsWith('/identity'))).toHaveLength(1)
  const reads = calls.filter((call) => !call.path.endsWith('/identity'))
  expect(reads.length).toBeGreaterThan(1)
  for (const read of reads)
    expect(read.input).toMatchObject({
      expectedReaderIdentity: 'jira-account',
      expectedDestination: 'jira-destination',
    })
})

it('lets the runtime reject a changed Jira account, rediscovers it and never adopts it', async () => {
  const { source, calls, identity } = fixture(() => ({ items: [issue(1)] }))
  const rawRead = source.reader.requestEffect
  const guardSchema = Schema.Struct({
    expectedDestination: Schema.optional(Schema.String),
    expectedReaderIdentity: Schema.optional(Schema.String),
  })
  // The runtime checks the sent guard against its current account, as forge-work does.
  const attempts: { path: string; input: unknown }[] = []
  source.reader.requestEffect = (path, input, schema) =>
    Effect.gen(function* () {
      attempts.push({ path, input })
      if (!path.endsWith('/identity'))
        yield* Effect.try({
          try: () => guardSource(identity, decode(guardSchema, input)),
          catch: (error) =>
            new RuntimeRequestError({ kind: 'response', status: 409, message: String(error) }),
        })
      return yield* rawRead(path, input, schema)
    })
  // The collection pins the account its discovery verified.
  const reader = { ...source.reader, readerIdentity: 'jira-account' }
  const pinned = { ...source, reader }
  await Effect.runPromise(loadWorkSourcePage(pinned, 'issues', '', 'open', false))
  identity.readerIdentity = 'replacement-account'
  attempts.length = 0
  await expect(
    Effect.runPromise(loadWorkSourcePage(pinned, 'issues', '', 'open', true)),
  ).rejects.toThrow(/changed/)
  // One guarded read with the old account, then rediscovery; the read is not retried.
  expect(attempts.map((call) => call.path)).toEqual([
    '/api/scm/work/issues/list',
    '/api/scm/source/identity',
  ])
  expect(attempts[0]?.input).toMatchObject({ expectedReaderIdentity: 'jira-account' })
  expect(calls.filter((call) => call.path.endsWith('/list'))).toHaveLength(1)
  attempts.length = 0
  // The rediscovered account differs from the pinned one, so the next read stops before dispatch.
  await expect(
    Effect.runPromise(loadWorkSourcePage(pinned, 'issues', '', 'open', true)),
  ).rejects.toThrow(/account changed/)
  expect(attempts).toEqual([])
})

it('verifies again after a failed discovery instead of reusing the old account', async () => {
  const { source, calls } = fixture(() => ({ items: [issue(1)] }))
  await Effect.runPromise(loadWorkSourcePage(source, 'issues', '', 'open', false))
  const rawRead = source.reader.requestEffect
  let fail = true
  source.reader.requestEffect = (path, input, schema) =>
    path.endsWith('/identity') && fail
      ? Effect.fail(new RuntimeRequestError({ kind: 'connection', message: 'Offline' }))
      : rawRead(path, input, schema)
  // A 409 makes the reader rediscover; that discovery fails during an outage.
  await Effect.runPromise(
    recheckSourceReader(
      source.reader,
      new RuntimeRequestError({ kind: 'response', status: 409, message: 'changed' }),
    ),
  )
  fail = false
  calls.length = 0
  await Effect.runPromise(loadWorkSourcePage(source, 'issues', '', 'open', true))
  expect(calls[0]?.path).toBe('/api/scm/source/identity')
})

it('publishes Jira content while options are still pending and retains it on an options failure', async () => {
  const { source } = fixture(() => ({ items: [issue(1)] }))
  const raw = source.reader.requestEffect
  let release: () => void = () => {
    throw new Error('Options not started')
  }
  let started: () => void = () => {}
  const pending = new Promise<void>((resolve) => {
    started = resolve
  })
  source.reader.requestEffect = (path, input, schema) =>
    path.endsWith('/options')
      ? Effect.promise(() => {
          started()
          return new Promise<void>((resolve) => {
            release = resolve
          })
        }).pipe(Effect.flatMap(() => Effect.fail(new Error('Jira options unavailable'))))
      : raw(path, input, schema)
  let visible: unknown
  const result = Effect.runPromise(
    loadWorkSourcePage(source, 'issues', '', 'open', false, undefined, undefined, (page) => {
      visible = page
    }),
  )
  await pending
  expect(visible).toMatchObject({ items: [issue(1)] })
  release()
  expect(await result).toMatchObject({
    items: [issue(1)],
    optionsError: 'Jira options unavailable',
  })
})

it('rechecks older Jira list pages after the bounded interval and keeps the prefix on failure', async () => {
  const { source, calls } = fixture(() => ({ items: [] }))
  const raw = source.reader.requestEffect
  let now = Date.now()
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
  let older = 'Original older issue'
  let fail = false
  source.reader.requestEffect = (path, input, schema) => {
    if (!path.endsWith('/issues/list')) return raw(path, input, schema)
    return Effect.try({
      try: () => {
        calls.push({ path, input })
        const query = decode(
          Schema.Struct({
            cursor: Schema.optional(Schema.String),
            knownVersion: Schema.optional(Schema.String),
          }),
          input,
        )
        if (query.cursor && fail) throw new Error('Older page unavailable')
        const readVersion = (query.cursor && older !== 'Original older issue' ? 'b' : 'a').repeat(
          64,
        )
        return decode(
          schema,
          query.knownVersion === readVersion
            ? { unchanged: true, readVersion }
            : {
                value: {
                  items: [
                    { ...issue(query.cursor ? 2 : 1), title: query.cursor ? older : 'First issue' },
                  ],
                  next: query.cursor ? undefined : '30',
                },
                readVersion,
              },
        )
      },
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    })
  }
  try {
    const first = await Effect.runPromise(
      loadWorkSourcePage(source, 'issues', '', 'all', false, {
        source,
        reader: source.reader,
        items: [],
        loadedPages: 2,
      }),
    )
    const previous = { ...first, source, reader: source.reader }
    now += 30_000
    const unchanged = await Effect.runPromise(
      loadWorkSourcePage(source, 'issues', '', 'all', false, previous),
    )
    expect(unchanged.items).toBe(first.items)
    expect(calls.filter((call) => call.path.endsWith('/list'))).toHaveLength(3)
    older = 'Edited older issue'
    now += 120_000
    const swept = await Effect.runPromise(
      loadWorkSourcePage(source, 'issues', '', 'all', false, {
        ...unchanged,
        source,
        reader: source.reader,
      }),
    )
    expect(swept.items[1]?.title).toBe(older)
    now += 120_000
    fail = true
    await expect(
      Effect.runPromise(
        loadWorkSourcePage(source, 'issues', '', 'all', false, {
          ...swept,
          source,
          reader: source.reader,
        }),
      ),
    ).rejects.toThrow('Older page unavailable')
    expect(swept.items).toHaveLength(2)
    expect(workPageCacheValue(swept)).not.toHaveProperty('liveFirstPage')
  } finally {
    clock.mockRestore()
  }
})
