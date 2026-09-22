import { expect, it } from 'vite-plus/test'
import { pullReference, taskPullLinks, verifyPullUrl } from './task-pull-links'

it('accepts numbers and supported forge URLs, rejecting malformed references', () => {
  expect(pullReference(' #42 ')).toEqual({ number: 42 })
  for (const path of ['pull', 'pulls', 'pull-requests', 'pullrequest']) {
    expect(pullReference(`https://forge.example/team/project/${path}/42/?x=1#notes`)).toEqual({
      number: 42,
      url: `https://forge.example/team/project/${path}/42`,
    })
  }
  for (const value of [
    '0',
    '-1',
    '4.5',
    '9007199254740992',
    'javascript:alert(1)',
    'https://forge.example/issues/42',
    'https://secret@forge.example/pull/42',
  ]) {
    expect(() => pullReference(value)).toThrow('Enter a PR number or a full pull request URL.')
  }
  expect(() =>
    verifyPullUrl('https://forge.example/other/pull/42', 'https://forge.example/team/pull/42'),
  ).toThrow(/different project/)
  expect(() => verifyPullUrl(undefined, 'https://forge.example/team/pull/42')).not.toThrow()
})

it('shows the source PR once alongside manually linked PRs', () => {
  const source = {
    number: 1,
    url: 'https://forge.example/team/pull/1',
    repositoryUrl: 'https://forge.example/team',
    headSha: 'a'.repeat(40),
    baseSha: 'b'.repeat(40),
  }
  expect(
    taskPullLinks({
      pullRequest: source,
      linkedPullRequests: [
        { ...source, title: 'Duplicate' },
        { ...source, number: 2, url: 'https://forge.example/team/pull/2', title: 'Related work' },
      ],
    }).map((link) => link.number),
  ).toEqual([1, 2])
})
