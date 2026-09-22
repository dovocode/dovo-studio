import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vite-plus/test'
import { createRuntimeReadCache, forgeIssueDetailSchema, type CacheStorage } from '@dovo/protocol'
import { assertWorkSource, workCacheKey } from './work-cache'

const repository = {
  id: 'shared-id',
  path: '/projects/example',
  forge: { connectionId: 'github', repository: 'team/example', revision: '1' },
}
const issue = forgeIssueDetailSchema.parse({
  issue: {
    id: '1',
    title: 'Retain draft',
    body: 'Details',
    state: 'open',
    url: 'https://github.com/team/example/issues/1',
    author: 'developer',
    assignees: [],
    labels: [],
    updatedAt: '2026-09-20T10:00:00Z',
    revision: '1',
  },
  comments: [],
})

function fixture() {
  const entries = new Map<string, string>()
  const storage: CacheStorage = {
    async getItem(key) {
      return entries.get(key) ?? null
    },
    async setItem(key, value) {
      entries.set(key, value)
    },
    async removeItem(key) {
      entries.delete(key)
    },
    async removePrefix(prefix) {
      for (const key of entries.keys()) if (key.startsWith(prefix)) entries.delete(key)
    },
  }
  return (address = 'http://first:51464', token = 'fixture-token') =>
    createRuntimeReadCache({ address, token }, storage, async (text) =>
      createHash('sha256').update(text).digest('hex'),
    )
}

describe('native work detail cache identity', () => {
  it('reopens a stored detail with a fresh cache instance without mixing computers or credentials', async () => {
    const cache = fixture()
    const key = workCacheKey(repository, 'issues', 'detail', { id: '1' })
    const original = cache()
    await original.write(key, issue)
    await original.close()
    expect((await cache().read(key, forgeIssueDetailSchema))?.value).toEqual(issue)
    expect(await cache('http://second:51464').read(key, forgeIssueDetailSchema)).toBeNull()
    expect(
      await cache('http://first:51464', 'replacement-token').read(key, forgeIssueDetailSchema),
    ).toBeNull()
  })

  it('does not reuse a detail after changing checkout, forge account, forge revision, or Jira binding', async () => {
    const cache = fixture()()
    await cache.write(workCacheKey(repository, 'issues', 'detail', { id: '1' }), issue)
    for (const changed of [
      { ...repository, path: '/projects/another' },
      { ...repository, forge: { ...repository.forge, connectionId: 'another-account' } },
      { ...repository, forge: { ...repository.forge, revision: '2' } },
      { ...repository, jira: { site: 'https://team.atlassian.net', project: 'DEV' } },
    ])
      expect(
        await cache.read(
          workCacheKey(changed, 'issues', 'detail', { id: '1' }),
          forgeIssueDetailSchema,
        ),
      ).toBeNull()
  })

  it('keeps collection pages, state filters, details and pipeline IDs separate', () => {
    const keys = [
      workCacheKey(repository, 'issues', 'options'),
      workCacheKey(repository, 'issues', 'list', { state: 'open' }),
      workCacheKey(repository, 'issues', 'list', { state: 'closed' }),
      workCacheKey(repository, 'issues', 'list', { state: 'open', query: 'search one' }),
      workCacheKey(repository, 'issues', 'list', { state: 'open', query: 'search two' }),
      workCacheKey(repository, 'issues', 'list', { state: 'open', cursor: 'next' }),
      workCacheKey(repository, 'issues', 'detail', { id: '1' }),
      workCacheKey(repository, 'issues', 'detail', { id: '2' }),
      workCacheKey(repository, 'pipelines', 'detail', { id: '1' }),
    ]
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('preserves existing offline keys for an empty search', () => {
    const legacy = JSON.stringify([
      'work',
      repository.id,
      repository.path,
      repository.forge,
      undefined,
      'issues',
      'list',
      undefined,
      'all',
      undefined,
    ])
    expect(workCacheKey(repository, 'issues', 'list', { state: 'all' })).toBe(legacy)
    expect(workCacheKey(repository, 'issues', 'list', { state: 'all', query: '  ' })).toBe(legacy)
  })

  it('validates cached data against the current detail schema', async () => {
    const cache = fixture()()
    const key = workCacheKey(repository, 'issues', 'detail', { id: '1' })
    await cache.write(key, { issue: { id: '1' }, comments: [] })
    expect(await cache.read(key, forgeIssueDetailSchema)).toBeNull()
  })

  it.each(['issues', 'pipelines'] as const)(
    'rejects a matching numeric ID from another %s source, including cached reads',
    (area) => {
      expect(() =>
        assertWorkSource(area, issue.issue.url, 'https://github.com/another/project/issues/1'),
      ).toThrow('different')
      expect(() => assertWorkSource(area, issue.issue.url, issue.issue.url)).not.toThrow()
      expect(() => assertWorkSource(area, issue.issue.url)).not.toThrow()
    },
  )
})
