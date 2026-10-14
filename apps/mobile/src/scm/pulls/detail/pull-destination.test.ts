import { describe, expect, it } from 'vite-plus/test'
import type { PullComment } from '@dovo/protocol'
import { pullDestination } from './pull-destination'
const comments: PullComment[] = [
  {
    id: '1',
    kind: 'comment',
    author: 'dominic',
    body: 'Review',
    date: '',
    url: 'https://github.com/o/r/pull/7#issuecomment-1',
  },
  {
    id: '2',
    kind: 'inline',
    path: 'src/old.ts',
    author: 'dominic',
    body: 'Fix',
    date: '',
    url: 'https://github.com/o/r/pull/7#discussion_r2',
  },
]
describe('native PR destinations', () => {
  it('routes discussion and inline fragments to their native sections', () => {
    expect(pullDestination({ comments }, 'overview', '#issuecomment-1')).toMatchObject({
      tab: 'discussion',
      comment: comments[0],
    })
    expect(pullDestination({ comments }, 'overview', '#discussion_r2')).toMatchObject({
      tab: 'changes',
      path: 'src/old.ts',
      comment: comments[1],
    })
  })
  it('preserves requested tabs and does not guess destinations for missing fragments', () => {
    expect(pullDestination({ comments }, 'checks', '')).toEqual({
      tab: 'checks',
      path: undefined,
      comment: undefined,
    })
    expect(pullDestination({ comments }, 'changes', '#not-loaded')).toEqual({
      tab: 'changes',
      path: undefined,
      comment: undefined,
    })
  })
})
