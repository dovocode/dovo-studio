import { expect, it } from 'vite-plus/test'
import { combinePullSections, matchingPullSection, type PullDetail } from './pulls'
import { pullDetailChecks, pullDetailReviews } from './pull-presentation'

const overview: PullDetail = {
  destination: 'account-repository',
  pull: {
    number: 7,
    title: 'PR',
    url: 'https://github.com/team/project/pull/7',
    repositoryUrl: 'https://github.com/team/project',
    state: 'open',
    draft: false,
    author: 'dominic',
    updatedAt: '',
    head: 'feature',
    base: 'main',
    labels: [],
    headSha: 'a'.repeat(40),
    baseSha: 'b'.repeat(40),
    body: 'Description',
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    mergeable: null,
    reviewers: [],
    assignees: [],
  },
  files: [],
  comments: [],
  checks: [],
  warnings: [],
}
it('combines independent resources without letting their failures mark the overview stale', () => {
  const result = combinePullSections(overview, {
    status: {
      ...overview,
      pull: { ...overview.pull, checksState: 'FAILURE', reviewDecision: 'CHANGES_REQUESTED' },
    },
    changes: {
      ...overview,
      files: [{ path: 'a.ts', status: 'added', additions: 1, deletions: 0 }],
    },
    checks: { ...overview, stale: true, refreshError: 'Checks unavailable' },
  })
  if (!result) throw new Error('Overview should be available')
  expect(result.pull.body).toBe('Description')
  expect(result?.files).toHaveLength(1)
  expect(result?.stale).toBeUndefined()
  expect(result?.refreshError).toBeUndefined()
  expect(pullDetailChecks(result)).toEqual({ label: 'Checks failed', tone: 'danger' })
  expect(pullDetailReviews(result)).toEqual({ label: 'Changes requested', tone: 'danger' })
})
it.each([
  { ...overview, pull: { ...overview.pull, headSha: 'c'.repeat(40) } },
  { ...overview, pull: { ...overview.pull, baseSha: 'c'.repeat(40) } },
  { ...overview, destination: 'other-account' },
  { ...overview, pull: { ...overview.pull, url: 'https://github.com/other/project/pull/7' } },
])('rejects a section for a different revision or destination', (section) => {
  const value = {
    ...section,
    files: [{ path: 'private.ts', status: 'added', additions: 1, deletions: 0 }],
  }
  expect(matchingPullSection(overview, value)).toBe(false)
  expect(combinePullSections(overview, { changes: value })?.files).toEqual([])
})
