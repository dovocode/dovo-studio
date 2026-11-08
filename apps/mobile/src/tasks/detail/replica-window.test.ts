import { expect, it } from 'vite-plus/test'
import type { Task } from '@dovo/protocol'
import { applyOlderReplicaPage, olderReplicaPageFit, replacedReplicaWindow } from './replica-window'

const message = (position: number) => ({
  id: `m${position}`,
  role: 'assistant' as const,
  text: `message ${position}`,
})
const range = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, index) => message(from + index))
const thread = (messages: Task['messages'], historyBefore?: string, historyRevision = 0): Task => ({
  id: 'shared',
  title: 'Shared',
  agentId: '',
  repositoryId: '',
  status: 'review',
  createdAt: '2026-10-02',
  draft: '',
  example: false,
  historyRevision,
  historyBefore,
  messages,
  files: [],
})

it('prepends an older page to the window that requested it', () => {
  const current = thread(range(40, 80), '40')
  const next = applyOlderReplicaPage(current, thread(range(0, 40), undefined), '40')
  expect(next.messages.map((item) => item.id)).toEqual(range(0, 80).map((item) => item.id))
  expect(next.historyBefore).toBeUndefined()
})

it('drops an older page that finished after a gap reset replaced the window', () => {
  // The reset tail starts after an unseen gap; its own cursor still reaches messages 100-119.
  const reset = thread(range(120, 160), '120')
  const stale = thread(range(0, 40), undefined)
  expect(applyOlderReplicaPage(reset, stale, '40')).toBe(reset)
})

it('drops an older page from another history revision', () => {
  const current = thread(range(40, 80), '40', 2)
  const rewritten = thread(range(0, 40), undefined, 3)
  // A rewrite after this window loaded needs the newest page, not an older one.
  expect(olderReplicaPageFit(current, rewritten, '40')).toBe('newer-revision')
  expect(applyOlderReplicaPage(current, rewritten, '40')).toBe(current)
  // A page from before a rewrite the window already shows belongs to a replaced window.
  const previous = thread(range(0, 40), undefined, 1)
  expect(olderReplicaPageFit(current, previous, '40')).toBe('window-changed')
  expect(olderReplicaPageFit(current, thread(range(0, 40), undefined, 2), '40')).toBe('apply')
})

it('detects a replaced window, not an extended one', () => {
  const window = range(40, 80)
  expect(replacedReplicaWindow(window, range(0, 80))).toBe(false)
  expect(replacedReplicaWindow(window, range(40, 85))).toBe(false)
  expect(replacedReplicaWindow(window, range(120, 160))).toBe(true)
  expect(replacedReplicaWindow([], range(0, 40))).toBe(false)
  expect(replacedReplicaWindow(window, [])).toBe(false)
})
