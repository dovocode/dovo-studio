import { expect, it } from 'vite-plus/test'
import type { ConversationPage, Task } from '@dovo/protocol'
import {
  conversationPagesSize,
  holdConversationPages,
  rememberConversationPages,
  restoreConversationPages,
  sessionHistoryBudget,
  trimConversationPages,
} from './history-retention'

type Message = Task['messages'][number]
const message = (id: string, role: Message['role'] = 'assistant', text = id): Message => ({
  id,
  role,
  text,
})
const conversation = (count: number, text = 'x'.repeat(1000)) =>
  Array.from({ length: count }, (_, index) =>
    message(`m${index}`, index % 2 ? 'assistant' : 'user', text),
  )
const page = (messages: Message[], historyRevision = 0): ConversationPage => ({
  messages,
  turns: messages
    .filter((item) => item.role === 'assistant')
    .map((item) => ({
      id: `turn-${item.id}`,
      assistantId: item.id,
      agentId: 'agent',
      provider: 'codex' as const,
      model: 'model',
      status: 'completed' as const,
      startedAt: '2026-10-13T00:00:00Z',
    })),
  historyRevision,
  before: messages[0]?.id,
})
const live = (messages: Message[], historyRevision = 0) => ({
  messages,
  turns: [],
  historyBefore: messages[0]?.id,
  historyRevision,
})

it('drops the oldest whole requests while keeping the recent and protected windows', () => {
  const messages = conversation(40)
  const pages = [page(messages)]
  const perMessage = conversationPagesSize([page([messages[1]!])])
  const trimmed = trimConversationPages(pages, { budget: perMessage * 10, keep: 6 })
  const kept = trimmed[0]!.messages
  expect(kept.at(-1)!.id).toBe('m39')
  expect(kept[0]!.role).toBe('user')
  expect(kept.length).toBeLessThanOrEqual(10)
  expect(kept.length).toBeGreaterThanOrEqual(6)
  expect(trimmed[0]!.before).toBe(kept[0]!.id)
  const ids = new Set(kept.map((item) => item.id))
  expect(trimmed[0]!.turns.every((turn) => ids.has(turn.assistantId))).toBe(true)

  const protectedTrim = trimConversationPages(pages, {
    budget: perMessage * 10,
    keep: 6,
    protectFrom: 'm12',
  })
  expect(protectedTrim[0]!.messages[0]!.id).toBe('m12')
  expect(trimConversationPages(pages, { budget: Infinity, keep: 6 })).toBe(pages)
})

it('keeps an oversized protected message whole', () => {
  const huge = message('huge', 'assistant', 'y'.repeat(200_000))
  const tail = ['t0', 't1', 't2', 't3'].map((id) => message(id))
  const messages = [...conversation(10), message('ask', 'user'), huge, ...tail]
  const trimmed = trimConversationPages([page(messages)], {
    budget: 1000,
    keep: 2,
    protectFrom: 'ask',
  })
  expect(trimmed[0]!.messages.map((item) => item.id)).toEqual([
    'ask',
    'huge',
    't0',
    't1',
    't2',
    't3',
  ])
  expect(trimmed[0]!.messages[1]!.text).toHaveLength(200_000)
})

it('restores remembered pages only when they still join the live window', () => {
  const older = conversation(20)
  const scope = 'http://lan:4317|paired|thread-a'
  const release = holdConversationPages(scope)
  rememberConversationPages(scope, 3, [page(older.slice(0, 12), 3)])
  release(live(older.slice(12), 3))

  // The live window moved on but still overlaps the remembered copy.
  const restored = restoreConversationPages(scope, 3, live(older.slice(16), 3))
  expect(restored.flatMap((item) => item.messages).map((item) => item.id)).toContain('m0')
  // A rewritten history revision or a gap would present missing messages as complete.
  expect(restoreConversationPages(scope, 4, live(older.slice(16), 4))).toEqual([])
  const gap = 'http://lan:4317|paired|thread-b'
  holdConversationPages(gap)(live(older.slice(12), 0))
  rememberConversationPages(gap, 0, [page(older.slice(0, 12))])
  expect(restoreConversationPages(gap, 0, live([message('new-a'), message('new-b')]))).toEqual([])
})

it('evicts the least recently shown conversations beyond the session budget', () => {
  const big = (id: string) =>
    message(id, 'assistant', 'z'.repeat(Math.ceil(sessionHistoryBudget / 2 / 2) + 1))
  const visit = (scope: string) => {
    const release = holdConversationPages(scope)
    const messages = [message(`${scope}-ask`, 'user'), big(`${scope}-reply`)]
    rememberConversationPages(scope, 0, [page(messages)])
    return () => release(live(messages))
  }
  visit('first')()
  visit('second')()
  const shown = visit('third')
  expect(restoreConversationPages('first', 0, live([message('first-ask', 'user')]))).toEqual([])
  expect(restoreConversationPages('second', 0, live([message('second-ask', 'user')]))).toHaveLength(
    0,
  )
  // The shown conversation is protected even though it alone fills most of the budget.
  visit('fourth')()
  expect(restoreConversationPages('third', 0, live([message('third-ask', 'user')]))).toHaveLength(1)
  shown()
})

it('keeps a second panel protected when an older reader releases an invalidated revision', () => {
  const scope = 'shared-panels-revision'
  const messages = conversation(20)
  const oldReader = holdConversationPages(scope)
  rememberConversationPages(scope, 3, [page(messages, 3)])
  expect(restoreConversationPages(scope, 4, live(messages, 4))).toEqual([])
  const newReader = holdConversationPages(scope)
  rememberConversationPages(scope, 4, [page(messages, 4)])
  oldReader(live(messages, 3))
  expect(restoreConversationPages(scope, 4, live(messages, 4))).toHaveLength(1)
  newReader(live(messages, 4))
})
