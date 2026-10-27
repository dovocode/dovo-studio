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

it('retains shifted PRs and removes closed PRs only after the opened depth is revalidated', () => {
  const previous = { ...page([7, 6, 5, 4], 2), firstPageIds: ['7', '6'] }
  const refreshed = refreshPullPage(previous, page([8, 7], 1), [page([6, 5], 2)])
  expect(refreshed.pulls.map((pull) => pull.number)).toEqual([8, 7, 6, 5])
  expect(refreshed.page).toBe(2)
  expect(refreshed.firstPageIds).toEqual(['8', '7'])
  expect(refreshed.stale).toBeUndefined()
  const closed = refreshPullPage(refreshed, page([8, 6], 1), [page([5], 2, false)])
  expect(closed.pulls.map((pull) => pull.number)).toEqual([8, 6, 5])
  expect(closed.hasMore).toBe(false)
})
it('deduplicates moving page boundaries and keeps the last refreshed cursor', () => {
  const result = refreshPullPage(undefined, page([8, 7], 1), [page([7, 6], 2)])
  expect(result.pulls.map((pull) => pull.number)).toEqual([8, 7, 6])
  expect(result.page).toBe(2)
  expect(result.hasMore).toBe(true)
})
it('retains the complete old snapshot on later-page errors or offline results', () => {
  const previous = { ...page([7, 6, 5, 4], 2), firstPageIds: ['7', '6'] }
  for (const failure of [{ refreshError: 'Page unavailable' }, { stale: true }]) {
    const result = refreshPullPage(previous, page([8, 7], 1), [{ ...page([6, 5], 2), ...failure }])
    expect(result.pulls).toEqual(previous.pulls)
    expect(result.page).toBe(2)
    expect(result.firstPageIds).toEqual(previous.firstPageIds)
    expect(result.stale).toBe(true)
    expect(result.refreshError).toBeTruthy()
  }
})
it('drops later rows when page one becomes complete', () => {
  const previous = { ...page([1, 2, 3], 2), firstPageIds: ['1', '2'] }
  expect(refreshPullPage(previous, page([4], 1, false)).pulls.map((pull) => pull.number)).toEqual([
    4,
  ])
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
  const result = refreshPullPage(previous, old)
  expect(result.pulls.map((pull) => pull.number)).toEqual([614, 608, 600])
  expect(result.page).toBe(2)
  expect(result.cachedAt).toBe(previous.cachedAt)
  expect(result.stale).toBe(true)
  expect(result.refreshError).toBe('PR computer offline')
  const next = { ...page([615], 1, false), cachedAt: '2026-10-20T12:00:00Z' }
  expect(refreshPullPage(previous, next).pulls.map((pull) => pull.number)).toEqual([615])
})
