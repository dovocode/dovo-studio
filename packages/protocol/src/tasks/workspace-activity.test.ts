import { expect, it } from 'vite-plus/test'
import { sortWorkspaceActivity, type WorkspaceActivity } from './workspace-activity'

it('mixes real input activity and retains terminal order when times are unknown', () => {
  const items: WorkspaceActivity[] = [
    { key: 'old-thread', kind: 'thread', pinned: false, activityAt: 1 },
    { key: 'terminal-z', kind: 'terminal', pinned: false },
    { key: 'page', kind: 'browser', pinned: false, activityAt: 2 },
    { key: 'new-thread', kind: 'thread', pinned: false, activityAt: 3 },
    { key: 'terminal-a', kind: 'terminal', pinned: false },
  ]
  expect(sortWorkspaceActivity(items, (item) => item).map((item) => item.key)).toEqual([
    'new-thread',
    'page',
    'old-thread',
    'terminal-z',
    'terminal-a',
  ])
  expect(items[0].key).toBe('old-thread')
})

it('preserves pinned page order and breaks timed ties by scoped identity', () => {
  const items: WorkspaceActivity[] = [
    { key: 'b', kind: 'thread', pinned: true, activityAt: 5 },
    { key: 'z-page', kind: 'browser', pinned: true, activityAt: 1 },
    { key: 'a-page', kind: 'browser', pinned: true, activityAt: 10 },
    { key: 'a', kind: 'thread', pinned: true, activityAt: 5 },
  ]
  expect(sortWorkspaceActivity(items, (item) => item).map((item) => item.key)).toEqual([
    'z-page',
    'a-page',
    'a',
    'b',
  ])
})

it('handles legacy or invalid timestamps without moving unknown items on each update', () => {
  const items: WorkspaceActivity[] = [
    { key: 'z', kind: 'thread', pinned: false, activityAt: NaN },
    { key: 'a', kind: 'browser', pinned: false, activityAt: Infinity },
    { key: 'b', kind: 'terminal', pinned: false },
  ]
  expect(sortWorkspaceActivity(items, (item) => item)).toEqual(items)
})
