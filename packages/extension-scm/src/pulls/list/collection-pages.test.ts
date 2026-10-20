import { expect, it } from 'vite-plus/test'
import type { PullPage } from '@dovo/studio-core'
import { refreshPullPage } from './collection-pages'

const page = (numbers: number[], number: number, hasMore = true): PullPage => ({
  pulls: numbers.map((id) => ({
    number: id,
    title: `PR ${id}`,
    url: `https://example.com/pulls/${id}`,
    state: 'open',
    draft: false,
    author: 'developer',
    updatedAt: '2026-09-24T00:00:00Z',
    head: 'feature',
    base: 'main',
    labels: [],
  })),
  page: number,
  hasMore,
})

it('refreshes page one while retaining loaded later rows and removing departed first-page rows', () => {
  const previous = {
    ...page([1, 2, 3], 2),
    firstPageIds: ['1', '2'],
    stale: true,
    refreshError: 'Previously offline',
  }
  const refreshed = refreshPullPage(previous, page([4, 1], 1), false)
  expect(refreshed.page).toBe(2)
  expect(refreshed.hasMore).toBe(true)
  expect(refreshed.firstPageIds).toEqual(['4', '1'])
  expect(refreshed.pulls.map((pull) => pull.number)).toEqual([4, 1, 3])
  expect(refreshed.stale).toBe(true)
  expect(refreshed.refreshError).toBeUndefined()
})

it('drops later rows when page one is complete or refresh is forced', () => {
  const previous = { ...page([1, 2, 3], 2), firstPageIds: ['1', '2'] }
  expect(
    refreshPullPage(previous, page([4], 1, false), false).pulls.map((pull) => pull.number),
  ).toEqual([4])
  const forced = refreshPullPage(previous, page([4], 1), true)
  expect(forced.page).toBe(1)
  expect(forced.pulls.map((pull) => pull.number)).toEqual([4])
})

it('preserves newer rows and loaded pagination when a returning gateway serves an older cache', () => {
  const previous = {
    ...page([614, 608, 600], 2),
    firstPageIds: ['614', '608'],
    cachedAt: '2026-10-20T11:45:00Z',
  }
  const old = {
    ...page([608], 1, false),
    cachedAt: '2026-10-19T08:39:00Z',
    stale: true,
    refreshError: 'PR computer offline',
  }
  for (const forced of [false, true]) {
    const result = refreshPullPage(previous, old, forced)
    expect(result.pulls.map((pull) => pull.number)).toEqual([614, 608, 600])
    expect(result.page).toBe(2)
    expect(result.cachedAt).toBe(previous.cachedAt)
    expect(result.stale).toBe(true)
    expect(result.refreshError).toBe('PR computer offline')
  }
  const next = { ...page([615], 1, false), cachedAt: '2026-10-20T12:00:00Z' }
  expect(refreshPullPage(previous, next, false).pulls.map((pull) => pull.number)).toEqual([615])
})
