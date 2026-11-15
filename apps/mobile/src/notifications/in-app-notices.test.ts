import { expect, it } from 'vite-plus/test'
import { taskNotificationEvents, type TaskState } from '@dovo/protocol'
import { reconcileInputNotices, type InAppInputNotice } from './in-app-notices'
import { deliverInAppNotification, registerInAppNotification } from './in-app-delivery'

const target = { runtimeId: 'one', viewId: 'tasks' as const, entityId: 'thread' }
const key = JSON.stringify(['one', 'thread'])
const id = JSON.stringify(['approval', 'review'])
const state = (inputIds: string[]): TaskState => ({
  target,
  title: 'Thread',
  inputIds,
  running: true,
  needsInput: inputIds.length > 0,
  failed: false,
})
const states = (ids: string[]) => new Map([[key, state(ids)]])
const events = taskNotificationEvents(states([]), states([id]))

it('queues each new request, suppresses the active thread only on its owning computer', () => {
  const notices = reconcileInputNotices([], states([id]), events)
  expect(notices).toHaveLength(1)
  expect(notices[0]).toMatchObject({ target, inputId: id, confirmed: true })
  expect(reconcileInputNotices([], states([id]), events, target)).toEqual([])
  expect(reconcileInputNotices([], states([id]), events, { ...target, runtimeId: 'two' })).toEqual(
    notices,
  )
  expect(reconcileInputNotices(notices, states([id]), events)).toEqual(notices)
})

it('clears only resolved requests, retaining a second request for the same thread', () => {
  const next = JSON.stringify(['question', 'next'])
  const notices = reconcileInputNotices(
    [],
    states([id, next]),
    taskNotificationEvents(states([]), states([id, next])),
  )
  expect(notices).toHaveLength(2)
  expect(reconcileInputNotices(notices, states([next]), [])).toEqual([notices[1]])
  expect(reconcileInputNotices(notices, states([]), [])).toEqual([])
  expect(reconcileInputNotices(notices, new Map(), [])).toEqual([])
})

it('deduplicates push and live updates while allowing a push to arrive before the snapshot', () => {
  const push: InAppInputNotice = { ...events[0]!, confirmed: false }
  expect(reconcileInputNotices([push], states([]), [])).toEqual([push])
  const confirmed = reconcileInputNotices([push], states([id]), events)
  expect(confirmed).toHaveLength(1)
  expect(confirmed[0]?.confirmed).toBe(true)
  expect(reconcileInputNotices(confirmed, states([]), [])).toEqual([])
})

it('never replays old requests after reconnect or queues completion notices', () => {
  expect(taskNotificationEvents(new Map(), states([id]))).toEqual([])
  const completed = taskNotificationEvents(
    states([]),
    new Map([[key, { ...state([]), running: false }]]),
  )
  expect(reconcileInputNotices([], states([]), completed)).toEqual([])
})

it('bounds queued requests without changing the order of retained requests', () => {
  const notices = Array.from({ length: 60 }, (_, index) => ({
    key: String(index),
    title: 'Thread',
    target,
    confirmed: false,
  }))
  expect(reconcileInputNotices(notices, states([]), [])).toEqual(notices.slice(-50))
})

it('keeps native push as fallback for invalid, background or unhandled notifications', () => {
  const data = {
    kind: 'input',
    runtimeId: 'one',
    taskId: 'thread',
    inputId: 'q',
    inputType: 'question',
  }
  expect(deliverInAppNotification(data, true)).toBe(false)
  const seen: unknown[] = []
  const remove = registerInAppNotification((target) => {
    seen.push(target)
    return true
  })
  try {
    for (const invalid of [
      null,
      {},
      { ...data, kind: 'done' },
      { ...data, inputId: '' },
      { ...data, inputType: 'other' },
    ])
      expect(deliverInAppNotification(invalid, true)).toBe(false)
    expect(deliverInAppNotification(data, false)).toBe(false)
    expect(seen).toEqual([])
    expect(deliverInAppNotification(data, true)).toBe(true)
    expect(seen).toEqual([
      { runtimeId: 'one', taskId: 'thread', inputId: 'q', inputType: 'question' },
    ])
  } finally {
    remove()
  }
  expect(deliverInAppNotification(data, true)).toBe(false)
})
