import { taskBudgetUsage } from '../tasks/task-budget'
import { expect, it, vi } from 'vite-plus/test'
import {
  compactConversationPages,
  conversationPage,
  conversationPageMessages,
  conversationWindowPage,
  mergeConversationHistory,
  readConversationHistory,
  threadContextSnapshot,
} from './history'
import type { ConversationPage } from './history'
type ReadHistory = (before: string, signal: AbortSignal) => Promise<ConversationPage>

it('compacts overlapping rolling windows without losing history or its oldest cursor', () => {
  let pages: ConversationPage[] = []
  for (let start = 0; start < 100; start++)
    pages = compactConversationPages([
      ...pages,
      {
        messages: Array.from({ length: 75 }, (_, index) => ({
          id: `m${start + index}`,
          role: 'assistant' as const,
          text: `version-${start}`,
        })),
        turns: [],
        before: `m${start}`,
      },
    ])
  expect(pages).toHaveLength(1)
  expect(pages[0]?.messages).toHaveLength(174)
  expect(pages[0]?.before).toBe('m0')
  expect(pages[0]?.messages.find((message) => message.id === 'm99')?.text).toBe('version-99')
})

it('keeps different history revisions separate when compacting offline pages', () => {
  const pages = compactConversationPages([
    { messages: [{ id: 'removed', role: 'user', text: 'Old' }], turns: [], historyRevision: 0 },
    { messages: [{ id: 'new', role: 'user', text: 'New' }], turns: [], historyRevision: 1 },
  ])
  expect(
    mergeConversationHistory({ messages: [], turns: [], historyRevision: 1 }, pages, false)
      .messages,
  ).toEqual([{ id: 'new', role: 'user', text: 'New' }])
})
it('retains ownership records when one execution spans multiple history pages', () => {
  const turn = {
    id: 'turn',
    assistantId: 'a99',
    agentId: 'agent',
    provider: 'codex' as const,
    model: '',
    startedAt: '',
    status: 'completed' as const,
  }
  const task = {
    messages: Array.from({ length: 100 }, (_, index) => ({
      id: `a${index}`,
      turnId: 'turn',
      role: 'assistant' as const,
      text: 'Message',
    })),
    turns: [turn],
  }
  const page = conversationPage(task, 'a25')
  expect(page.turns).toEqual([turn])
  const live = { ...task, messages: task.messages.slice(25), historyBefore: 'a25' }
  expect(mergeConversationHistory(live, [page]).turns).toEqual([turn])
})
const history = (requests: number) => ({
  messages: Array.from({ length: requests * 2 }, (_, index) => ({
    id: `m${index}`,
    role: index % 2 ? ('assistant' as const) : ('user' as const),
    text: `Message ${index}`,
  })),
  turns: [],
})
it('attaches complete history from the runtime rather than a possibly partial list projection', async () => {
  const all = { ...history(80), historyRevision: 3 }
  const read = vi.fn<(before: string | undefined) => Promise<ConversationPage>>(async (before) =>
    conversationPage(all, before),
  )
  const result = await threadContextSnapshot(
    { title: 'A / project' },
    read,
    new AbortController().signal,
  )
  expect(read.mock.calls[0]?.[0]).toBeUndefined()
  expect(read.mock.calls.length).toBeGreaterThan(1)
  expect(result.name).toBe('Thread - A - project.md')
  expect(result.text).toContain('Message 0')
  expect(result.text).toContain('Message 159')
})
it('rejects changed history, oversized UTF-8 transcripts, and cancellation', async () => {
  const signal = new AbortController()
  await expect(
    threadContextSnapshot(
      { title: 'Thread' },
      async (before) =>
        before
          ? { messages: [], turns: [], historyRevision: 2 }
          : {
              messages: [{ id: 'm', role: 'user', text: 'latest' }],
              turns: [],
              before: 'm',
              historyRevision: 1,
            },
      signal.signal,
    ),
  ).rejects.toThrow('changed')
  await expect(
    threadContextSnapshot(
      { title: 'Thread' },
      async () => ({
        messages: [{ id: 'm', role: 'user', text: '😀'.repeat(1_400_000) }],
        turns: [],
      }),
      signal.signal,
    ),
  ).rejects.toThrow('too large')
  signal.abort()
  await expect(
    threadContextSnapshot(
      { title: 'Thread' },
      async () => ({ messages: [], turns: [] }),
      signal.signal,
    ),
  ).rejects.toThrow('cancelled')
})
it('copies a captured transcript in chronological order without refetching its loaded recent window', async () => {
  const all = { ...history(31), historyRevision: 2 }
  const task = { ...all, messages: all.messages.slice(40), historyBefore: 'm50' }
  const read = vi.fn<ReadHistory>(async (before: string) => conversationPage(all, before))
  const result = await readConversationHistory(task, read, new AbortController().signal)
  expect(read.mock.calls[0]?.[0]).toBe('m40')
  expect(result.messages).toEqual(all.messages)
  expect(task.messages).toHaveLength(22)
})
it('rejects copy pages from a different history revision', async () => {
  const task = { ...history(1), historyBefore: 'm0', historyRevision: 1 }
  await expect(
    readConversationHistory(
      task,
      async () => ({
        messages: [{ id: 'old', role: 'user', text: 'Removed history' }],
        turns: [],
        historyRevision: 2,
      }),
      new AbortController().signal,
    ),
  ).rejects.toThrow('Conversation changed')
})
it.each(['same', 'cycle', 'empty'] as const)(
  'stops copying a %s nonadvancing cursor',
  async (kind) => {
    const task = { ...history(1), historyBefore: 'm0' }
    const read = vi.fn<ReadHistory>(async (before: string) => ({
      messages: kind === 'empty' ? [] : [{ id: 'old', role: 'user' as const, text: 'Old' }],
      turns: [],
      before: kind === 'same' ? before : before === 'm0' ? 'older' : 'm0',
    }))
    await expect(readConversationHistory(task, read, new AbortController().signal)).rejects.toThrow(
      'History did not advance',
    )
    expect(read.mock.calls.length).toBeLessThanOrEqual(2)
  },
)
it('cancels copying before requests or after a request completes', async () => {
  const task = { ...history(1), historyBefore: 'm0' }
  const controller = new AbortController()
  const read = vi.fn<ReadHistory>(async () => ({ messages: [], turns: [] }))
  controller.abort()
  await expect(readConversationHistory(task, read, controller.signal)).rejects.toThrow('cancelled')
  expect(read).not.toHaveBeenCalled()
  const pending = new AbortController()
  await expect(
    readConversationHistory(
      task,
      async () => {
        pending.abort()
        return { messages: [], turns: [] }
      },
      pending.signal,
    ),
  ).rejects.toThrow('cancelled')
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
    historyBefore: 'new',
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

it('treats live membership as authoritative after history captures a live window', () => {
  const old = { id: 'old', role: 'assistant' as const, text: 'Old' }
  const current = { id: 'live', role: 'assistant' as const, text: 'Current' }
  const removed = { id: 'feedback', role: 'user' as const, text: 'Deleted' }
  const pages = [{ messages: [old, current, removed], turns: [] }]
  const live = { messages: [current], turns: [], historyBefore: 'live' }
  expect(mergeConversationHistory(live, pages).messages).toEqual([old, current])
  expect(mergeConversationHistory({ ...live, historyBefore: undefined }, pages).messages).toEqual([
    current,
  ])
  expect(mergeConversationHistory({ messages: [], turns: [] }, pages, false).messages).toEqual(
    pages[0]?.messages,
  )
})

it('rejects pages from before removal or rewind even without a matching live boundary', () => {
  const old = history(50)
  const saved = { ...conversationPage(old), historyRevision: 0 }
  const live = { ...history(35), historyRevision: 1, historyBefore: 'm50' }
  live.messages = live.messages.slice(50)
  expect(mergeConversationHistory(live, [saved]).messages).toEqual(live.messages)
  expect(conversationPage(live).historyRevision).toBe(1)
  const removedOlder = { ...live, historyRevision: 2 }
  expect(
    mergeConversationHistory(removedOlder, [{ ...saved, historyRevision: 1 }]).messages,
  ).toEqual(live.messages)
})
it('rejects offline pages older than a known summary revision', () => {
  const saved = { ...conversationPage(history(5)), historyRevision: 0 }
  const summary = { messages: [], turns: [], historyRevision: 1 }
  expect(mergeConversationHistory(summary, [saved], false)).toBe(summary)
  const restored = mergeConversationHistory(
    { messages: [], turns: [], historyRevision: 0 },
    [{ ...saved, historyRevision: 1 }],
    false,
  )
  expect(restored.messages).toEqual(saved.messages)
  expect(restored.historyRevision).toBe(1)
})
it('pages a bounded stored window like the complete history it was read from', () => {
  const all = { ...history(60), historyRevision: 1 }
  for (const before of [undefined, 'm119', 'm76', 'm75', 'm20', 'm1']) {
    const end = before === undefined ? all.messages.length : Number(before.slice(1))
    expect(
      conversationWindowPage({
        messages: all.messages.slice(Math.max(0, end - conversationPageMessages - 1), end),
        turns: [],
        historyRevision: 1,
      }),
    ).toEqual(conversationPage(all, before))
  }
})
