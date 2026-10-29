import { expect, it } from 'vite-plus/test'
import {
  combinePullSections,
  matchingPullSection,
  pullChangesSnapshot,
  type PullDetail,
} from './pulls'
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
it('uses fresh lifecycle status only for the matching PR revision and account', () => {
  const status: PullDetail = {
    ...overview,
    pull: {
      ...overview.pull,
      draft: true,
      mergeable: true,
      mergeStateStatus: 'DRAFT',
      autoMergeEnabled: false,
      inMergeQueue: false,
    },
    capabilities: { actions: ['draft'], mergeMethods: ['squash'], reviewDecisions: [] },
  }
  const combined = combinePullSections(overview, { status })
  expect(combined?.pull).toMatchObject({
    draft: true,
    mergeStateStatus: 'DRAFT',
    autoMergeEnabled: false,
  })
  expect(combined?.capabilities?.actions).toContain('draft')
  expect(
    combinePullSections(overview, { status: { ...status, destination: 'other-account' } })?.pull
      .draft,
  ).toBe(false)
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

it('keeps the previous diff as a read-only display while a matching PR loads its new revision', () => {
  const previous = {
    ...overview,
    files: [{ path: 'a.ts', status: 'added', additions: 1, deletions: 0 }],
  }
  const pushed = { ...overview, pull: { ...overview.pull, headSha: 'c'.repeat(40) } }
  expect(pullChangesSnapshot(pushed, false, previous)).toEqual({ ...previous, stale: true })
  expect(pullChangesSnapshot(pushed, true, previous)).toBe(pushed)
  expect(pushed.files).toEqual([])
})
it.each([
  null,
  { ...overview, destination: undefined },
  { ...overview, destination: 'another-account' },
  { ...overview, pull: { ...overview.pull, connectionId: 'another-account' } },
  { ...overview, pull: { ...overview.pull, url: 'https://github.com/other/project/pull/7' } },
])('never retains a diff across missing or different PR/account identities', (current) => {
  expect(pullChangesSnapshot(current, false, overview)).toBeNull()
})

it.each(['closed', 'merged'] as const)(
  'uses matching %s status instead of an older open overview',
  (state) => {
    const status = { ...overview, pull: { ...overview.pull, state } }
    expect(combinePullSections(overview, { status })?.pull.state).toBe(state)
    expect(
      combinePullSections(overview, { status: { ...status, destination: 'other-account' } })?.pull
        .state,
    ).toBe('open')
  },
)

it('does not let an older same-head closed status undo a freshly reopened overview', () => {
  const opened = { ...overview, pull: { ...overview.pull, updatedAt: '2026-10-29T10:00:00Z' } }
  const closed: PullDetail = {
    ...overview,
    pull: {
      ...overview.pull,
      state: 'closed',
      draft: true,
      mergeable: false,
      mergeStateStatus: 'DIRTY',
      autoMergeEnabled: true,
      inMergeQueue: true,
      updatedAt: '2026-10-29T11:00:00Z',
    },
    capabilities: { actions: ['reopen'], mergeMethods: [], reviewDecisions: [] },
  }
  expect(combinePullSections(opened, { status: closed })?.pull.state).toBe('closed')
  const reopened: PullDetail = {
    ...overview,
    pull: {
      ...overview.pull,
      updatedAt: '2026-10-29T12:00:00Z',
      mergeable: true,
      mergeStateStatus: 'CLEAN',
      autoMergeEnabled: false,
      inMergeQueue: false,
    },
    capabilities: { actions: ['draft'], mergeMethods: ['squash'], reviewDecisions: [] },
  }
  const combined = combinePullSections(reopened, { status: closed })
  expect(combined?.pull).toMatchObject({
    state: 'open',
    draft: false,
    mergeable: true,
    mergeStateStatus: 'CLEAN',
    autoMergeEnabled: false,
    inMergeQueue: false,
  })
  expect(combined?.capabilities).toEqual(reopened.capabilities)
  const newer = { ...closed, pull: { ...closed.pull, updatedAt: '2026-10-29T13:00:00Z' } }
  expect(combinePullSections(reopened, { status: newer })?.pull.state).toBe('closed')
})
