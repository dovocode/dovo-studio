import { describe, expect, it } from 'vite-plus/test'
import type { PullDetail } from '@dovo/protocol'
import { pullActionOptions } from './pull-action-options'

const detail: PullDetail = {
  pull: {
    number: 12,
    title: 'Keep the conversation draft',
    url: 'https://github.com/dovo/studio/pull/12',
    repositoryUrl: 'https://github.com/dovo/studio',
    state: 'open',
    draft: false,
    author: 'dominic',
    updatedAt: '2026-09-20T10:00:00Z',
    head: 'fix/draft',
    base: 'main',
    headSha: 'a'.repeat(40),
    baseSha: 'b'.repeat(40),
    body: '',
    labels: [],
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    mergeable: true,
    reviewers: [],
    assignees: [],
  },
  comments: [],
  files: [],
  checks: [],
  warnings: [],
  capabilities: {
    actions: [
      'comment',
      'review',
      'edit',
      'reviewers',
      'merge',
      'close',
      'reopen',
      'reply',
      'resolve',
    ],
    reviewDecisions: ['comment', 'approve', 'request-changes'],
    mergeMethods: ['squash'],
  },
}

describe('mobile PR action placement', () => {
  it('keeps Review primary and puts supported secondary actions in one menu', () => {
    const options = pullActionOptions(detail)
    expect(options.primary?.action).toBe('review')
    expect(options.secondary.map(({ action }) => action)).toEqual([
      'comment',
      'edit',
      'reviewers',
      'merge',
      'close',
    ])
  })

  it('never offers merge or review without supported methods or decisions', () => {
    const options = pullActionOptions({
      ...detail,
      capabilities: {
        actions: ['review', 'merge', 'comment', 'close'],
        reviewDecisions: [],
        mergeMethods: [],
      },
    })
    expect(options.primary?.action).toBe('comment')
    expect(options.secondary.map(({ action }) => action)).toEqual(['close'])
  })

  it('allows a closed PR to reopen, but never offers reopening or merging a merged PR', () => {
    const closed = pullActionOptions({ ...detail, pull: { ...detail.pull, state: 'closed' } })
    expect(closed.primary?.action).toBe('comment')
    expect(closed.secondary.map(({ action }) => action)).toEqual(['reopen'])
    const merged = pullActionOptions({ ...detail, pull: { ...detail.pull, state: 'merged' } })
    expect(merged.primary?.action).toBe('comment')
    expect(merged.secondary).toEqual([])
  })

  it('does not promote a destructive action when a provider only supports closing', () => {
    const options = pullActionOptions({
      ...detail,
      capabilities: { actions: ['close'], reviewDecisions: [], mergeMethods: [] },
    })
    expect(options.primary).toBeUndefined()
    expect(options.secondary).toEqual([{ action: 'close', label: 'Close PR' }])
  })

  it('does not invent actions before provider capabilities are known', () => {
    expect(pullActionOptions({ ...detail, capabilities: undefined })).toEqual({
      primary: undefined,
      secondary: [],
    })
  })
})
