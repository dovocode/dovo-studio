import { expect, it } from 'vite-plus/test'
import { decode } from '../../shared/schema'
import { taskSchema } from '../../workspace'
import {
  githubPullTarget,
  addTaskPullLinks,
  pullReferencesInText,
  threadPullLink,
} from './pull-links'
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

it('builds thread links from full PR URLs and normalizes GitHub detail tabs', () => {
  expect(threadPullLink('https://github.com/team/project/pull/42/files#note')).toEqual({
    number: 42,
    url: 'https://github.com/team/project/pull/42',
    title: 'PR #42',
    provider: 'github',
    repositoryUrl: 'https://github.com/team/project',
  })
  expect(threadPullLink('http://forge.local/team/project/pulls/7?tab=checks')).toMatchObject({
    number: 7,
    url: 'http://forge.local/team/project/pulls/7',
    repositoryUrl: 'http://forge.local/team/project',
  })
  for (const input of [
    '#42',
    'https://github.com/team/project/issues/42',
    'https://user@host/pull/42',
  ])
    expect(threadPullLink(input)).toBeNull()
})
