import { expect, it } from 'vite-plus/test'
import type { PullComment } from './pulls.js'
import { pullDiscussionGroups } from './pull-discussions.js'

const comment = (id: string, extra: Partial<PullComment> = {}): PullComment => ({
  id,
  author: 'Dominic',
  kind: 'inline',
  body: id,
  date: '2026-11-14T00:00:00Z',
  url: `https://example.test/#${id}`,
  resolved: true,
  ...extra,
})
it('collapses only wholly resolved inline groups and follows reply chains', () => {
  const groups = pullDiscussionGroups([
    comment('first'),
    comment('reply', { replyTo: 'first' }),
    comment('general', { kind: 'comment' }),
    comment('review', { kind: 'review' }),
    comment('mixed', { threadId: 'thread' }),
    comment('open', { threadId: 'thread', resolved: false }),
    comment('unknown', { resolved: undefined }),
  ])
  expect(groups.map((group) => [group.comments.map((item) => item.id), group.resolved])).toEqual([
    [['first', 'reply'], true],
    [['general'], false],
    [['review'], false],
    [['mixed', 'open'], false],
    [['unknown'], false],
  ])
})
it('handles unavailable parents and cycles without hiding unresolved evidence', () => {
  const groups = pullDiscussionGroups([
    comment('a', { replyTo: 'missing' }),
    comment('b', { replyTo: 'missing' }),
    comment('c', { replyTo: 'd' }),
    comment('d', { replyTo: 'c', resolved: false }),
  ])
  expect(groups[0]?.comments.map((item) => item.id)).toEqual(['a', 'b'])
  expect(groups.flatMap((group) => group.comments)).toHaveLength(4)
  expect(groups.find((group) => group.comments.some((item) => item.id === 'd'))?.resolved).toBe(
    false,
  )
})
