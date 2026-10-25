import { expect, it } from 'vite-plus/test'
import { taskPullLinks, taskPullStatusFor } from './task-pull-links'

it('uses fresher linked metadata for settled primary PRs and retains known titles', () => {
  const primary = {
    number: 7,
    url: 'https://github.com/o/r/pull/7',
    state: 'open' as const,
    draft: false,
    checkedAt: '2026-10-14T00:00:00Z',
  }
  const cached = {
    ...primary,
    state: 'merged' as const,
    title: 'Merged fix',
    checkedAt: '2026-10-15T00:00:00Z',
  }
  const task = {
    pullStatus: primary,
    pullStatuses: [cached],
    linkedPullRequests: [
      { number: 7, url: primary.url, repositoryUrl: 'https://github.com/o/r', title: 'PR #7' },
    ],
  }
  expect(taskPullStatusFor(task, primary.url)).toMatchObject({
    state: 'merged',
    title: 'Merged fix',
  })
  expect(taskPullLinks(task)[0].title).toBe('Merged fix')
  expect(
    taskPullStatusFor(
      { ...task, pullStatus: { ...primary, state: 'closed', checkedAt: '2026-10-16T00:00:00Z' } },
      primary.url,
    ),
  ).toMatchObject({ state: 'closed', title: 'Merged fix' })
  expect(taskPullStatusFor(task, 'https://github.com/o/r/pull/8')).toBeUndefined()
})

it('finds source and additional thread links without confusing repositories, hosts or examples', async () => {
  const { pullLinkedTasks } = await import('./task-pull-links')
  const url = 'https://github.com/o/r/pull/7'
  const source = {
    example: false,
    pullRequest: {
      number: 7,
      url: `${url}/?tab=checks#summary`,
      repositoryUrl: 'https://github.com/o/r',
      headSha: 'head',
      baseSha: 'base',
    },
  }
  const linked = {
    example: false,
    linkedPullRequests: [{ number: 7, url, title: 'Fix', repositoryUrl: 'https://github.com/o/r' }],
  }
  expect(
    pullLinkedTasks(
      [
        source,
        linked,
        { ...source, example: true },
        {
          ...source,
          pullRequest: { ...source.pullRequest, url: 'https://github.com/other/r/pull/7' },
        },
      ],
      'https://GITHUB.com/O/R/pull/7',
    ),
  ).toEqual([source, linked])
  expect(pullLinkedTasks([source], 'https://elsewhere.test/o/r/pull/7')).toEqual([])
  expect(pullLinkedTasks([source], 'invalid')).toEqual([])
})
