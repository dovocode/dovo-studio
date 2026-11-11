import { expect, it } from 'vite-plus/test'
import type { PullComment, PullDetail } from './pulls.js'
import { pullReadiness, type PullReadinessResources } from './pull-readiness.js'

const ready = { ready: true, readConnected: true }
const loaded: PullReadinessResources = { status: ready, checks: ready, discussion: ready }
function fixture(): PullDetail {
  return {
    pull: {
      number: 7,
      title: 'Review',
      url: 'https://github.com/team/repo/pull/7',
      repositoryUrl: 'https://github.com/team/repo',
      state: 'open',
      draft: false,
      author: 'dominic',
      updatedAt: '',
      head: 'feature',
      base: 'main',
      labels: [],
      headSha: 'a'.repeat(40),
      baseSha: 'b'.repeat(40),
      body: '',
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      mergeable: true,
      mergeStateStatus: 'CLEAN',
      checksState: 'SUCCESS',
      reviewDecision: 'APPROVED',
      reviewers: [],
      assignees: [],
    },
    files: [],
    comments: [],
    checks: [],
    warnings: [],
  }
}
function comment(id: string, fields: Partial<PullComment> = {}): PullComment {
  return {
    id,
    author: 'sam',
    body: '',
    date: '2026-11-11',
    url: `https://github.com/team/repo/pull/7#${id}`,
    kind: 'inline',
    ...fields,
  }
}

it('keeps CI pending while check reports are empty or only completed jobs have arrived', () => {
  for (const checksState of [
    'PENDING',
    'EXPECTED',
    'queued',
    'IN_PROGRESS',
    'running',
    'WAITING',
  ]) {
    const detail = fixture()
    detail.pull.checksState = checksState
    const empty = pullReadiness(detail, loaded)
    expect(empty.headline.label).toBe('Waiting for CI')
    expect(empty.metrics[0]?.signal).toEqual({
      label: 'CI pending · waiting for check reports',
      tone: 'warning',
    })
    expect(empty.metrics[0]?.segments).toEqual([])
    detail.checks = [{ name: 'Build', status: 'SUCCESS' }]
    const partial = pullReadiness(detail, loaded).metrics[0]!
    expect(partial.signal.label).toContain('1 passed · CI pending')
    expect(partial.signal.tone).toBe('warning')
    expect(partial.segments).toEqual([])
  }
})

it('distinguishes queued, running and expected reports without hiding failures', () => {
  const detail = fixture()
  detail.checks = ['QUEUED', 'IN_PROGRESS', 'EXPECTED', 'FAILURE'].map((status) => ({
    name: status,
    status,
  }))
  const summary = pullReadiness(detail, loaded)
  expect(summary.headline.label).toBe('CI failed')
  expect(summary.metrics[0]?.signal).toEqual({
    label: '1 failed · 1 running · 1 queued · 1 pending',
    tone: 'danger',
  })
})

it('uses known pending pipelines only for the current commit without inventing check counts', () => {
  const detail = fixture()
  const run = {
    id: '42',
    title: 'CI',
    url: 'https://github.com/team/repo/actions/runs/42',
    ref: 'feature',
    sha: detail.pull.headSha,
    actor: 'dominic',
    status: 'queued',
    createdAt: '',
    updatedAt: '',
  }
  const summary = pullReadiness(detail, loaded, [run])
  expect(summary.headline.label).toBe('Waiting for CI')
  expect(summary.metrics[0]?.signal).toEqual({ label: '1 pipeline pending', tone: 'warning' })
  expect(summary.metrics[0]?.segments).toEqual([])
  const unloaded = pullReadiness(detail, { ...loaded, checks: { ready: false } }, [run])
  expect(unloaded.headline.label).toBe('Waiting for CI')
  expect(unloaded.metrics[0]?.signal).toEqual({
    label: '1 pipeline pending · details not loaded',
    tone: 'warning',
  })
  expect(pullReadiness(detail, loaded, [{ ...run, sha: 'c'.repeat(40) }]).headline.label).toBe(
    'Ready to merge',
  )
  detail.pull.mergeable = false
  expect(pullReadiness(detail, loaded, [run]).headline.label).toBe('Merge conflicts')
})

it('keeps cached pending states distinct from current pending reports', () => {
  const detail = fixture()
  detail.pull.checksState = 'PENDING'
  const offline = { ready: true, readConnected: false }
  const summary = pullReadiness(detail, { status: offline, checks: offline, discussion: offline })
  expect(summary.headline.label).toBe('Saved merge status')
  expect(summary.metrics[0]?.signal.tone).toBe('neutral')
  expect(summary.metrics[0]?.signal.label).toContain('saved')
})

it('uses provider merge readiness and keeps conflict-free distinct from ready to merge', () => {
  const detail = fixture()
  expect(pullReadiness(detail, loaded).headline.label).toBe('Ready to merge')
  delete detail.pull.mergeStateStatus
  expect(pullReadiness(detail, loaded).headline.label).toBe('No merge conflicts')
  expect(pullReadiness(detail, loaded).description).toContain('Check the repository requirements')
  detail.pull.mergeStateStatus = 'BEHIND'
  expect(pullReadiness(detail, loaded).headline.label).toBe('Branch update required')
  expect(pullReadiness(detail, loaded).description).toContain('main')
})

it('counts mixed checks without treating skipped or unknown reports as passed', () => {
  const detail = fixture()
  detail.checks = ['SUCCESS', 'FAILURE', 'IN_PROGRESS', 'SKIPPED', 'CUSTOM_STATE'].map(
    (status) => ({ name: status, status }),
  )
  const metric = pullReadiness(detail, loaded).metrics[0]!
  expect(metric.signal).toEqual({
    label: '1 failed · 1 running · 1 passed · 1 skipped · 1 other',
    tone: 'danger',
  })
  expect(metric.segments).toEqual([
    { tone: 'positive', count: 1 },
    { tone: 'danger', count: 1 },
    { tone: 'warning', count: 1 },
    { tone: 'neutral', count: 2 },
  ])
})

it('deduplicates review threads and preserves unknown resolution metadata', () => {
  const detail = fixture()
  detail.comments = [
    comment('root', { threadId: 'thread-1', resolved: true }),
    comment('reply', { threadId: 'thread-1', replyTo: 'root' }),
    comment('other', { resolved: true }),
    comment('blocked', { threadId: 'thread-2', resolved: false }),
    comment('old-metadata', { threadId: 'thread-2', resolved: true }),
    comment('unknown'),
    comment('discussion', { kind: 'comment' }),
  ]
  const metric = pullReadiness(detail, loaded).metrics[1]!
  expect(metric.signal).toEqual({
    label: '1 unresolved · 2 resolved · 1 with unknown status',
    tone: 'warning',
  })
  expect(metric.segments).toEqual([
    { tone: 'positive', count: 2 },
    { tone: 'warning', count: 1 },
    { tone: 'neutral', count: 1 },
  ])
  expect(metric.description).toContain('1 discussion comment.')
})

it('uses the latest reviewer decision once and does not count approved reviewers as pending', () => {
  const detail = fixture()
  detail.pull.reviewers = ['sam', 'lee', 'lee', 'dismissed']
  detail.comments = [
    comment('old', { kind: 'review', state: 'CHANGES_REQUESTED', date: '2026-11-10' }),
    comment('new', { kind: 'review', state: 'APPROVED' }),
    comment('dismiss-old', {
      kind: 'review',
      author: 'dismissed',
      state: 'APPROVED',
      date: '2026-11-10',
    }),
    comment('dismiss-new', { kind: 'review', author: 'dismissed', state: 'DISMISSED' }),
  ]
  const metric = pullReadiness(detail, loaded).metrics[2]!
  expect(metric.signal.label).toBe('1 approved · 2 pending')
  expect(metric.segments).toEqual([
    { tone: 'positive', count: 1 },
    { tone: 'neutral', count: 2 },
  ])
})

it('does not show a full approval bar when required reviews have an unknown count', () => {
  const detail = fixture()
  detail.pull.reviewDecision = 'REVIEW_REQUIRED'
  detail.comments = [comment('approved', { kind: 'review', state: 'APPROVED' })]
  const metric = pullReadiness(detail, loaded).metrics[2]!
  expect(metric.signal.label).toBe('1 approved · required review pending')
  expect(metric.signal.tone).toBe('warning')
  expect(metric.segments).toEqual([])
})

it('uses known mobile aggregate state without inventing report or approval counts', () => {
  const detail = fixture()
  detail.pull.commentCount = 4
  const summary = pullReadiness(detail, {
    status: ready,
    checks: { ready: false },
    discussion: { ready: false },
  })
  expect(summary.metrics.map((metric) => metric.signal.label)).toEqual([
    'CI status: passed · details not loaded',
    '4 comments · details not loaded',
    'Approved · details not loaded',
  ])
  expect(summary.metrics.every((metric) => metric.segments.length === 0)).toBe(true)
})

it('keeps missing and empty data neutral instead of showing completion', () => {
  const detail = fixture()
  detail.pull.reviewDecision = null
  const empty = pullReadiness(detail, loaded)
  expect(empty.metrics.every((metric) => metric.signal.tone === 'neutral')).toBe(true)
  expect(empty.metrics.every((metric) => metric.segments.length === 0)).toBe(true)
  const missing = pullReadiness(detail, {
    status: { ready: false },
    checks: { ready: false },
    discussion: { ready: false },
  })
  expect(missing.headline).toEqual({ label: 'Merge readiness pending', tone: 'neutral' })
})

it('marks cached and offline data without presenting it as current success', () => {
  const detail = fixture()
  detail.checks = [{ name: 'Tests', status: 'SUCCESS' }]
  const cached = { ...ready, detail: { stale: true } }
  const summary = pullReadiness(detail, {
    status: cached,
    checks: cached,
    discussion: { ...ready, readConnected: false },
  })
  expect(summary.headline).toEqual({ label: 'Saved merge status', tone: 'warning' })
  expect(summary.metrics.every((metric) => metric.signal.label.endsWith(' · saved'))).toBe(true)
  expect(summary.metrics[0]?.segments).toEqual([{ tone: 'neutral', count: 1 }])
})

it('keeps resource failures independent and does not replace them with aggregate success', () => {
  const detail = fixture()
  const failed = { ...ready, error: 'Temporary failure' }
  const summary = pullReadiness(detail, { status: failed, checks: failed, discussion: failed })
  expect(summary.headline.label).toBe('Merge readiness unavailable')
  expect(summary.metrics.every((metric) => metric.signal.label === 'Unavailable')).toBe(true)
  expect(summary.metrics.every((metric) => metric.segments.length === 0)).toBe(true)
  expect(detail.stale).toBeUndefined()
})

it.each(['merged', 'closed'] as const)(
  'keeps %s lifecycle status when live requirements are not loaded',
  (state) => {
    const detail = fixture()
    detail.pull.state = state
    expect(
      pullReadiness(detail, { status: { ready: false }, checks: ready, discussion: ready }).headline
        .label,
    ).toBe(state === 'merged' ? 'Already merged' : 'Pull request closed')
  },
)
