import { expect, it } from 'vitest'
import { Effect } from 'effect'
import {
  decode,
  forgeIssueSchema,
  forgeWorkOptionsSchema,
  forgeWorkQuerySchema,
  runtimeProfile,
  type RuntimeReadCache,
} from '@dovo/protocol'
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
function fixture(response: (input: unknown) => unknown) {
  const calls: { path: string; input: unknown }[] = []
  const profile = runtimeProfile(
    { address: 'http://mac.local:51464', token: 'paired-fixture-token' },
    'Mac',
  )
  const requestEffect: WorkSource['requestEffect'] = (path, input, schema) =>
    Effect.try({
      try: () => {
        calls.push({ path, input })
        return decode(schema, path.endsWith('/options') ? options : response(input))
      },
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    })
  const source = {
    key: 'mac-jira-tracker',
    scope: 'mac-jira-tracker-v1',
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
  return { source, calls }
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
  expect(calls.at(-1)).toMatchObject({ input: { jiraSourceId: 'tracker', state: 'open' } })
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
    { path: '/api/scm/work/options', input: { jiraSourceId: 'tracker', area: 'issues' } },
    {
      path: '/api/scm/work/issues/list',
      input: {
        jiraSourceId: 'tracker',
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
        state: 'open',
        query: 'triage',
        cursor: '30',
        refresh: true,
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
    loadWorkSourcePage(source, 'issues', '', 'closed', false, { ...saved, source }),
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
