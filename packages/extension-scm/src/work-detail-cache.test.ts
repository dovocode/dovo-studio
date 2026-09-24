import { expect, it } from 'vite-plus/test'
import { createRuntimeReadCache, type CacheStorage, type Repository } from '@dovo/protocol'
import { readWorkDetailCache, workDetailCacheKeys } from './work-detail-cache'

const repository: Repository = { id: 'repo', name: 'Project', path: '/project', branch: 'main' }
const detail = {
  issue: {
    id: '7',
    title: 'Fix',
    body: 'Details',
    state: 'open',
    url: 'https://github.com/me/project/issues/7',
    author: 'me',
    assignees: [],
    labels: [],
    updatedAt: '',
    revision: 'one',
  },
  comments: [],
}
function fixture() {
  const values = new Map<string, string>()
  const storage: CacheStorage = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value)
    },
    removeItem: async (key) => {
      values.delete(key)
    },
    removePrefix: async (prefix) => {
      for (const key of values.keys()) if (key.startsWith(prefix)) values.delete(key)
    },
  }
  return (token = 'credential') =>
    createRuntimeReadCache(
      { address: 'http://runtime.local', token },
      storage,
      async (value) => value,
    )
}

it('restores saved issue details after reopening without a network request and isolates credentials', async () => {
  const cache = fixture()
  const keys = workDetailCacheKeys({ repository }, 'issues', '7')
  await cache().write(keys.detail, detail)
  await cache().write(keys.options, {
    provider: 'github',
    issues: true,
    pipelines: true,
    pipelineActions: [],
  })
  const restored = await readWorkDetailCache(cache(), keys, 'issues', detail.issue.url)
  expect(restored.issue?.issue.title).toBe('Fix')
  expect(restored.options?.provider).toBe('github')
  expect((await readWorkDetailCache(cache('other'), keys, 'issues')).issue).toBeUndefined()
})

it('never restores a same-number issue from another source, and invalidated details stay absent', async () => {
  const cache = fixture()()
  const keys = workDetailCacheKeys({ repository }, 'issues', '7')
  await cache.write(keys.detail, detail)
  await expect(
    readWorkDetailCache(cache, keys, 'issues', 'https://github.com/other/repo/issues/7'),
  ).rejects.toThrow('source changed')
  const moved = workDetailCacheKeys(
    { repository: { ...repository, path: '/other-project' } },
    'issues',
    '7',
  )
  expect((await readWorkDetailCache(cache, moved, 'issues')).issue).toBeUndefined()
  await cache.remove(keys.detail)
  expect((await readWorkDetailCache(cache, keys, 'issues')).issue).toBeUndefined()
})

it('separates issue IDs and pipeline details', () => {
  const first = workDetailCacheKeys({ repository }, 'issues', '7')
  expect(workDetailCacheKeys({ repository }, 'pipelines', '7').detail).not.toBe(first.detail)
  expect(workDetailCacheKeys({ repository }, 'issues', '8').detail).not.toBe(first.detail)
})

it('retains paginated comments and the loaded-page count across reopening', async () => {
  const cache = fixture()
  const keys = workDetailCacheKeys({ repository }, 'issues', '7')
  await cache().write(keys.detail, {
    ...detail,
    loadedPages: 2,
    comments: [
      { id: 'old', body: 'First page', author: 'me', createdAt: '' },
      { id: 'new', body: 'Second page', author: 'me', createdAt: '' },
    ],
  })
  const restored = await readWorkDetailCache(cache(), keys, 'issues')
  expect(restored.issue?.comments.map((comment) => comment.id)).toEqual(['old', 'new'])
  expect(restored.issue?.loadedPages).toBe(2)
})

it('isolates independent Jira sites and projects', () => {
  const jira = { id: 'jira', site: 'https://team.atlassian.net', project: 'APP' }
  const keys = workDetailCacheKeys({ jira }, 'issues', 'APP-1')
  expect(
    workDetailCacheKeys(
      { jira: { ...jira, site: 'https://other.atlassian.net' } },
      'issues',
      'APP-1',
    ).detail,
  ).not.toBe(keys.detail)
  expect(
    workDetailCacheKeys({ jira: { ...jira, project: 'OTHER' } }, 'issues', 'APP-1').detail,
  ).not.toBe(keys.detail)
})
