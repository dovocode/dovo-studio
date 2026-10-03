import { expect, it } from 'vitest'
import { decode } from '../../shared/schema'
import { taskSchema } from '../../workspace'
import { githubPullTarget, addTaskPullLinks, pullReferencesInText } from './pull-links'
it('extracts normalized PR links from Markdown and prose across supported forge URL shapes', () => {
  expect(
    pullReferencesInText(
      'See [PR](https://github.com/o/r/pull/7?tab=checks#note). Also https://gitlab.example/o/r/-/merge_requests/8, and https://github.com/o/r/pull/7.',
    ),
  ).toEqual([
    { number: 7, url: 'https://github.com/o/r/pull/7' },
    { number: 8, url: 'https://gitlab.example/o/r/-/merge_requests/8' },
  ])
  expect(
    pullReferencesInText(
      '#123 https://github.com/o/r/issues/1 https://secret@host/pull/1 https://host/pull/0',
    ),
  ).toEqual([])
})

it('routes GitHub PR detail links while excluding issues, credentials and lookalike hosts', () => {
  for (const suffix of ['', '/', '/files', '/commits', '/checks', '?tab=checks#comment']) {
    expect(githubPullTarget(`https://github.com/Team/Repo/pull/42${suffix}`)).toEqual({
      number: 42,
      identity: 'github.com/team/repo',
      url: 'https://github.com/Team/Repo/pull/42',
    })
  }
  for (const url of [
    'https://github.com.evil.test/o/r/pull/1',
    'https://github.com/o/r/issues/1',
    'https://user@github.com/o/r/pull/1',
    'https://github.com/o/r/pull/0',
    'https://github.com/o/r/pull/9007199254740992',
  ])
    expect(githubPullTarget(url)).toBeNull()
})
it('adds foreign-project PR links idempotently without changing checkout, launch state or primary PR', () => {
  const task = decode(taskSchema, {
    id: 'task',
    title: 'Thread',
    repositoryId: 'other',
    agentId: '',
    status: 'draft',
    createdAt: '',
    messages: [],
    files: [],
    draft: 'pending',
    example: false,
    checkoutBranch: 'main',
    ignoredPullRequestUrls: ['https://github.com/o/r/pull/1'],
  })
  const pull = {
    number: 1,
    url: 'https://github.com/o/r/pull/1',
    repositoryUrl: 'https://github.com/o/r',
    title: 'PR',
    provider: 'github' as const,
  }
  const linked = addTaskPullLinks(task, [pull, pull])
  expect(linked.linkedPullRequests).toEqual([pull])
  expect(linked.ignoredPullRequestUrls).toEqual([])
  expect(linked.repositoryId).toBe('other')
  expect(linked.checkoutBranch).toBe('main')
  expect(linked.draft).toBe('pending')
  expect(linked.status).toBe('draft')
  expect(addTaskPullLinks(linked, [pull])).toEqual(linked)
  expect(() =>
    addTaskPullLinks(
      task,
      Array.from({ length: 21 }, (_, i) => ({
        ...pull,
        number: i + 1,
        url: `https://github.com/o/r/pull/${i + 1}`,
      })),
    ),
  ).toThrow('at most 20')
})
