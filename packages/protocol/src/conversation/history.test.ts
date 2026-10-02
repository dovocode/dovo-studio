import { taskBudgetUsage } from '../tasks/task-budget'
import { expect, it } from 'vitest'
import { conversationPage, mergeConversationHistory } from './history'
const history = (requests: number) => ({
  messages: Array.from({ length: requests * 2 }, (_, index) => ({
    id: `m${index}`,
    role: index % 2 ? ('assistant' as const) : ('user' as const),
    text: `Message ${index}`,
  })),
  turns: [],
})
it('walks all history with stable message cursors while new replies arrive', () => {
  const task = history(31)
  const recent = conversationPage(task)
  expect(recent.messages).toHaveLength(20)
  expect(recent.before).toBe('m42')
  task.messages.push({ id: 'new', role: 'assistant', text: 'new reply' })
  const pages = [recent]
  while (pages[0]!.before) pages.unshift(conversationPage(task, pages[0]!.before))
  const merged = mergeConversationHistory(task, pages)
  expect(merged.messages).toEqual(task.messages)
  expect(new Set(merged.messages.map((message) => message.id)).size).toBe(63)
})
it('bounds long assistant sequences and preserves a whole oversized message', () => {
  const task = history(1)
  task.messages.push(
    ...Array.from({ length: 150 }, (_, index) => ({
      id: `a${index}`,
      role: 'assistant' as const,
      text: 'response',
    })),
  )
  expect(conversationPage(task).messages).toHaveLength(75)
  task.messages.push({ id: 'large', role: 'assistant', text: 'x'.repeat(1100000) })
  const page = conversationPage(task)
  expect(page.messages).toEqual([task.messages.at(-1)])
  expect(page.before).toBe('large')
})
it('rejects a stale cursor and lets current edits supersede cached pages', () => {
  const task = history(1)
  expect(() => conversationPage(task, 'gone')).toThrow('cursor')
  const page = conversationPage(task)
  const updated = {
    ...task,
    messages: task.messages.map((message) => ({ ...message, bookmarked: true })),
  }
  const result = mergeConversationHistory(updated, [page])
  expect(result.messages[1]).toBe(updated.messages[1])
  expect(result.messages[1]?.bookmarked).toBe(true)
})
it('keeps full budget totals correct as older pages become visible', () => {
  const oldTurn = {
    id: 'old',
    assistantId: 'm1',
    agentId: 'agent',
    provider: 'codex' as const,
    model: '',
    startedAt: '2026-10-01T00:00:00Z',
    finishedAt: '2026-10-01T00:01:00Z',
    status: 'completed' as const,
    tokens: 100,
  }
  const live = {
    messages: [{ id: 'new', role: 'assistant' as const, text: 'Current' }],
    turns: [],
    historyTotals: { tokens: 100, milliseconds: 60000, hasChanges: false },
  }
  const page = {
    messages: [{ id: 'm1', role: 'assistant' as const, text: 'Old' }],
    turns: [oldTurn],
  }
  const expanded = mergeConversationHistory(live, [page])
  expect(taskBudgetUsage(live).tokens).toBe(100)
  expect(taskBudgetUsage(expanded).tokens).toBe(100)
  expect(taskBudgetUsage(expanded).minutes).toBe(1)
})

it('counts checkpoint file contents in the page budget without discarding them', () => {
  const task = {
    messages: [
      { id: 'old', role: 'assistant' as const, text: 'Old' },
      { id: 'new', role: 'assistant' as const, text: 'New' },
    ],
    turns: [
      {
        id: 'turn',
        assistantId: 'old',
        agentId: 'agent',
        provider: 'codex' as const,
        model: '',
        startedAt: '2026-10-01T00:00:00Z',
        status: 'completed' as const,
        checkpoint: {
          before: 'ref',
          after: 'after',
          files: [{ path: 'large.txt', before: '', after: 'x'.repeat(500000), viewed: false }],
          omitted: [],
        },
      },
    ],
  }
  const recent = conversationPage(task)
  expect(recent.messages.map((message) => message.id)).toEqual(['new'])
  const older = conversationPage(task, recent.before)
  expect(older.turns[0]?.checkpoint?.files[0]?.after).toHaveLength(500000)
  expect(older.turns[0]?.checkpoint?.omitted).toEqual([])
})
