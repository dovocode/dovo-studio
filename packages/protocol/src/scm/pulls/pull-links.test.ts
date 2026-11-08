import { expect, it } from 'vite-plus/test'
import { decode } from '../../shared/schema'
import { taskSchema } from '../../workspace'
import {
  githubPullTarget,
  forgePullTarget,
  addTaskPullLinks,
  pullReferencesInText,
  threadPullLink,
} from './pull-links'
it('matches mixed-case GHE clone identities only with confirmed GitHub provider semantics', () => {
  const url = 'https://github.internal/team/project/pull/7'
  expect(
    forgePullTarget(url, [{ provider: 'github', identity: 'github.internal/Team/Project' }])
      ?.identity,
  ).toBe('github.internal/team/project')
  expect(forgePullTarget(url, [{ identity: 'github.internal/Team/Project' }])).toBeNull()
  expect(
    forgePullTarget('https://git.internal/team/project/pulls/7', [
      { provider: 'gitea', identity: 'git.internal/Team/Project' },
    ]),
  ).toBeNull()
})
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
      navigationUrl: `https://github.com/Team/Repo/pull/42${suffix === '/' ? '' : suffix}`,
      tab:
        suffix === '/checks'
          ? 'checks'
          : ['/files', '/commits'].includes(suffix)
            ? 'changes'
            : 'overview',
      fragment: suffix.includes('#') ? '#comment' : '',
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
it('keeps canonical identity separate from the requested PR section and comment', () => {
  expect(githubPullTarget('http://github.com/o/r/pull/7/files/#discussion_r123')).toMatchObject({
    url: 'https://github.com/o/r/pull/7',
    navigationUrl: 'https://github.com/o/r/pull/7/files#discussion_r123',
    tab: 'changes',
    fragment: '#discussion_r123',
  })
  expect(githubPullTarget('https://github.com/o/r/pull/7#issuecomment-42')).toMatchObject({
    tab: 'overview',
    fragment: '#issuecomment-42',
  })
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

it('recognizes configured Enterprise and Forgejo repositories without trusting arbitrary hosts', () => {
  const bindings = [
    { provider: 'github' as const, identity: 'github.internal/team/project' },
    { provider: 'forgejo' as const, identity: 'forge.internal/Team/Project' },
  ]
  expect(
    forgePullTarget('http://github.internal/Team/Project/pull/42/files#discussion', bindings),
  ).toMatchObject({
    provider: 'github',
    number: 42,
    identity: 'github.internal/team/project',
    url: 'http://github.internal/Team/Project/pull/42',
    tab: 'changes',
    fragment: '#discussion',
  })
  expect(
    forgePullTarget('http://forge.internal/Team/Project/pulls/42/commits', bindings),
  ).toMatchObject({ provider: 'forgejo', tab: 'changes' })
  for (const url of [
    'https://github.internal.evil/Team/Project/pull/42',
    'https://github.internal/Team/Other/pull/42',
    'https://forge.internal/Team/Project/pull/42',
    'https://user@forge.internal/Team/Project/pulls/42',
    'https://forge.internal/Team/Project/pulls/9007199254740992',
    'https://forge.internal/Team/Project/pulls/42/unknown',
  ])
    expect(forgePullTarget(url, bindings)).toBeNull()
})

it('recognizes nested GitLab merge requests and separates repository identity from tabs', () => {
  const bindings = [{ identity: 'gitlab.internal/group/subgroup/project' }]
  expect(
    forgePullTarget(
      'http://gitlab.internal/group/subgroup/project/-/merge_requests/42/pipelines#note_7',
      bindings,
    ),
  ).toMatchObject({
    provider: 'gitlab',
    identity: 'gitlab.internal/group/subgroup/project',
    number: 42,
    url: 'http://gitlab.internal/group/subgroup/project/-/merge_requests/42',
    navigationUrl:
      'http://gitlab.internal/group/subgroup/project/-/merge_requests/42/pipelines#note_7',
    tab: 'checks',
    fragment: '#note_7',
  })
  expect(
    forgePullTarget('https://gitlab.com/group/subgroup/project/-/merge_requests/7/diffs'),
  ).toMatchObject({ tab: 'changes' })
  expect(forgePullTarget('https://gitlab.com.evil/group/project/-/merge_requests/7')).toBeNull()
  expect(
    forgePullTarget('https://gitlab.internal/42/subgroup/project/-/merge_requests/42', [
      { identity: 'gitlab.internal/42/subgroup/project' },
    ])?.url,
  ).toBe('https://gitlab.internal/42/subgroup/project/-/merge_requests/42')
})

it('routes configured Gitea and Azure DevOps PRs and retains explicit providers', () => {
  expect(
    forgePullTarget('http://gitea.local/team/project/pulls/7/files', [
      { provider: 'gitea', identity: 'gitea.local/team/project' },
    ]),
  ).toMatchObject({ provider: 'gitea', tab: 'changes' })
  const url = 'https://dev.azure.com/org/project/_git/repository/pullrequest/7'
  expect(
    forgePullTarget(url, [
      { provider: 'azure-devops', identity: 'dev.azure.com/org/project/_git/repository' },
    ]),
  ).toMatchObject({ provider: 'azure-devops', number: 7, url })
  expect(forgePullTarget(url)).toBeNull()
  expect(
    threadPullLink('https://gitlab.com/group/project/-/merge_requests/7/diffs#note'),
  ).toMatchObject({
    provider: 'gitlab',
    number: 7,
    url: 'https://gitlab.com/group/project/-/merge_requests/7',
  })
})
