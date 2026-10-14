import { expect, it } from 'vite-plus/test'
import { createPullStateCache } from './retained-state'

it('evicts the least recently used PR draft when the cache reaches its bound', () => {
  const cache = createPullStateCache<string>(2)
  cache.write('owner-a/account-1/repo/7', 'unfinished suggestion')
  cache.write('owner-a/account-1/repo/8', 'oldest draft')
  expect(cache.read('owner-a/account-1/repo/7')).toBe('unfinished suggestion')
  cache.write('owner-b/account-1/repo/9', 'new draft')
  expect(cache.read('owner-a/account-1/repo/8')).toBeUndefined()
  expect(cache.read('owner-a/account-1/repo/7')).toBe('unfinished suggestion')
  expect(cache.read('owner-b/account-1/repo/9')).toBe('new draft')
})

it('updates a retained record without consuming another cache entry', () => {
  const cache = createPullStateCache<string>(2)
  cache.write('first', 'original')
  cache.write('second', 'untouched')
  cache.write('first', 'edited offline')
  expect(cache.read('first')).toBe('edited offline')
  expect(cache.read('second')).toBe('untouched')
})
