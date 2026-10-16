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
