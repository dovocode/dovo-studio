import { describe, expect, it } from 'vitest'
import { pullSummarySchema, type PullComment } from './pulls.js'
import {
  comparePulls,
  pullNextStep,
  latestPullReviews,
  matchesPull,
  pullChecks,
  pullNeedsAttention,
  pullState,
  checkSignal,
  pullCommentSignal,
} from './pull-presentation.js'
const pull = pullSummarySchema.parse({
  number: 7,
  title: 'Fix cancellation',
  url: 'https://github.com/test/repo/pull/7',
  state: 'open',
  draft: false,
  author: 'dominic',
  updatedAt: '2026-09-12T10:00:00Z',
  head: 'fix/cancel',
  base: 'main',
  labels: ['bug'],
})
describe('PR presentation', () => {
  it('distinguishes review decisions from discussion and code feedback without relying on body text', () => {
    expect(pullCommentSignal({ kind: 'review', state: 'APPROVED' })).toEqual({
      label: 'Approved',
      tone: 'positive',
    })
    expect(pullCommentSignal({ kind: 'review', state: 'CHANGES_REQUESTED' })).toEqual({
      label: 'Changes requested',
      tone: 'danger',
    })
    expect(pullCommentSignal({ kind: 'review', state: 'COMMENTED' }).label).toBe('Review comment')
    expect(pullCommentSignal({ kind: 'review', state: 'DISMISSED' }).label).toBe('Review dismissed')
    expect(pullCommentSignal({ kind: 'review', state: 'PENDING' }).tone).toBe('warning')
    expect(pullCommentSignal({ kind: 'review', state: 'UNKNOWN' }).label).toBe('Review')
    expect(pullCommentSignal({ kind: 'comment', state: 'APPROVED' })).toEqual({
      label: 'Discussion',
      tone: 'neutral',
    })
    expect(pullCommentSignal({ kind: 'inline' }).label).toBe('Code comment')
    expect(pullCommentSignal({ kind: 'inline', replyTo: 'first' }).label).toBe('Code reply')
  })
  it('distinguishes unknown, unavailable and absent checks', () => {
    expect(pullChecks(pull).label).toBe('Checks not loaded')
    expect(pullChecks({ ...pull, checksState: null }).label).toBe('No checks')
    expect(pullChecks({ ...pull, checksState: 'SUCCESS', statusError: 'Offline' }).label).toBe(
      'Checks unavailable',
    )
  })
  it('prioritizes open actionable PRs without claiming all open PRs need attention', () => {
    const failed = { ...pull, checksState: 'FAILURE', updatedAt: '2026-09-11T10:00:00Z' }
    expect([pull, failed].sort(comparePulls)[0]).toBe(failed)
    expect(pullNeedsAttention({ ...failed, state: 'merged' })).toBe(false)
    expect(pullNeedsAttention({ ...pull, reviewDecision: 'REVIEW_REQUIRED' })).toBe(false)
    expect(pullNeedsAttention({ ...pull, reviewDecision: 'CHANGES_REQUESTED' })).toBe(true)
    expect(comparePulls(pull, failed, false)).toBeLessThan(0)
  })
  it('shows terminal state even if a closed PR was a draft', () => {
    expect(pullState({ ...pull, draft: true, state: 'closed' }).label).toBe('Closed')
  })
  it('searches repositories, numbers, people and branches with multiple terms', () => {
    expect(matchesPull(pull, 'studio', 'studio #7 fix/cancel dominic')).toBe(true)
    expect(matchesPull(pull, 'studio', 'studio absent')).toBe(false)
  })
  it('uses the latest decisive review even when comments arrive out of order', () => {
    const review: PullComment = {
      id: '1',
      author: 'reviewer',
      body: '',
      date: '2026-09-12T10:00:00Z',
      url: pull.url,
      kind: 'review',
      state: 'APPROVED',
    }
    expect(
      latestPullReviews([
        { ...review, id: '2', date: '2026-09-12T11:00:00Z', state: 'DISMISSED' },
        review,
        { ...review, id: '3', date: '2026-09-12T12:00:00Z', state: 'COMMENTED' },
      ])[0].state,
    ).toBe('DISMISSED')
  })
  it('does not count skipped checks as passed or pending', () => {
    expect(checkSignal('success').tone).toBe('positive')
    expect(checkSignal('SKIPPED').tone).toBe('neutral')
    expect(checkSignal('TIMED_OUT').tone).toBe('danger')
    expect(checkSignal('IN_PROGRESS').tone).toBe('warning')
  })
})

it('prioritizes my review requests and my blocked PRs before other work', () => {
  const review = { ...pull, viewerReviewRequested: true }
  const mine = { ...pull, viewerIsAuthor: true, checksState: 'FAILURE' }
  const other = { ...pull, viewerIsAuthor: false, checksState: 'FAILURE' }
  expect([other, mine, review].sort(comparePulls)).toEqual([review, mine, other])
  expect(pullNextStep(review).label).toBe('Your review requested')
  expect(pullNextStep(mine).label).toBe('Fix failing checks')
  expect(pullNeedsAttention({ ...review, draft: true })).toBe(false)
  expect(pullNeedsAttention({ ...review, state: 'closed' })).toBe(false)
})
it('does not promise merge readiness or trust unavailable statuses', () => {
  expect(
    pullNextStep({
      ...pull,
      viewerIsAuthor: true,
      checksState: 'SUCCESS',
      reviewDecision: 'APPROVED',
    }).label,
  ).toBe('Review merge readiness')
  expect(pullNextStep({ ...pull, statusError: 'Offline', viewerReviewRequested: true }).label).toBe(
    'Refresh unavailable status',
  )
})

it('keeps Azure waiting-for-author actionable for its author without treating it as a rejection', () => {
  const mine = {
    ...pull,
    provider: 'azure-devops' as const,
    viewerIsAuthor: true,
    reviewDecision: 'WAITING_FOR_AUTHOR',
  }
  const other = { ...mine, viewerIsAuthor: false }
  expect(pullNextStep(mine)).toEqual({ label: 'Respond to review feedback', tone: 'warning' })
  expect(pullNextStep(other)).toEqual({ label: 'Waiting for author', tone: 'neutral' })
  expect(pullNeedsAttention(mine)).toBe(true)
  expect(pullNeedsAttention(other)).toBe(false)
  expect([other, mine].sort(comparePulls)).toEqual([mine, other])
  expect(pullCommentSignal({ kind: 'review', state: 'WAITING_FOR_AUTHOR' }).tone).toBe('warning')
})

it('includes approval with suggestions when suggesting a merge-readiness review', () => {
  const approved = {
    ...pull,
    viewerIsAuthor: true,
    reviewDecision: 'APPROVED_WITH_SUGGESTIONS',
    checksState: 'SUCCESS',
  }
  expect(pullNextStep(approved).label).toBe('Review merge readiness')
  expect(pullNeedsAttention(approved)).toBe(true)
  expect(pullCommentSignal({ kind: 'review', state: 'APPROVED_WITH_SUGGESTIONS' }).label).toBe(
    'Approved with suggestions',
  )
})
