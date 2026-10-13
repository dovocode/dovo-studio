import { expect, it } from 'vite-plus/test'
import {
  cachedThread,
  cachedRuntimeThread,
  retainCachedThreads,
  boundedSnapshotCache,
  writeRuntimeSnapshotCache,
} from './thread-cache.js'
import { createRuntimeReadCache, type CacheStorage } from './read-cache.js'
import { Effect } from 'effect'
import { decode } from '../../shared/schema.js'
import { snapshotSchema } from '../connection/runtime.js'
import type { Task } from '../../workspace.js'
import { taskBudgetUsage } from '../../tasks/task-budget.js'
const task = (id: string): Task => ({
  id,
  title: id,
  agentId: '',
  repositoryId: '',
  status: 'draft',
  createdAt: '2026-10-02',
  draft: '',
  example: false,
  messages: [{ id: 'reply', role: 'assistant', text: 'Cached history' }],
  files: [{ path: 'code.ts', viewed: false, before: 'old', after: 'new' }],
})
const snapshot = (tasks: Task[], detailTaskIds?: string[]) =>
  decode(snapshotSchema, {
    revision: 1,
    owner: false,
    detailTaskIds,
    workspace: {
      version: 1,
      runtimeAddress: '',
      agents: [],
      repositories: [],
      tasks,
      automations: [],
    },
    approvals: [],
    questions: [],
    terminals: [],
    runs: [],
    devices: [],
    pendingDevices: [],
  })
it('shares the bounded decoded writer replica without restoring removed history or another cache binding', async () => {
  const entries = new Map<string, string>()
  const storage: CacheStorage = {
    async getItem(key) {
      return entries.get(key) ?? null
    },
    async setItem(key, value) {
      entries.set(key, value)
    },
    async removeItem(key) {
      entries.delete(key)
    },
    async removePrefix(prefix) {
      for (const key of entries.keys()) if (key.startsWith(prefix)) entries.delete(key)
    },
  }
  const cache = createRuntimeReadCache(
    { address: 'http://host', token: 'one' },
    storage,
    async (value) => value,
  )
  const other = createRuntimeReadCache(
    { address: 'http://host', token: 'two' },
    storage,
    async (value) => value,
  )
  try {
    const saved = snapshot([task('a')], ['a'])
    await Effect.runPromise(
      writeRuntimeSnapshotCache(cache, { snapshot: saved, lastSeen: null, pulls: null }),
    )
    expect(cachedRuntimeThread(cache, 'a')).toBe(saved.workspace.tasks[0])
    expect(cachedRuntimeThread(other, 'a')).toBeUndefined()
    await cache.close()
    expect(cachedRuntimeThread(cache, 'a')).toBeUndefined()
    const reopened = createRuntimeReadCache(
      { address: 'http://host', token: 'one' },
      storage,
      async (value) => value,
    )
    await Effect.runPromise(
      writeRuntimeSnapshotCache(reopened, { snapshot: saved, lastSeen: null, pulls: null }),
    )
    await Effect.runPromise(
      writeRuntimeSnapshotCache(reopened, {
        snapshot: snapshot([{ ...task('a'), historyRevision: 1, messages: [] }], []),
        lastSeen: null,
        pulls: null,
      }),
    )
    expect(cachedRuntimeThread(reopened, 'a')).toBeUndefined()
    await reopened.close()
  } finally {
    await cache.close()
    await other.close()
  }
})
it('bounds persisted thread details while preserving metadata and prioritizing the latest selections', () => {
  const tasks = Array.from({ length: 30 }, (_, index) => task(String(index)))
  const bounded = boundedSnapshotCache(snapshot(tasks, tasks.map((task) => task.id).reverse()))
  expect(bounded.detailTaskIds).toHaveLength(20)
  expect(bounded.detailTaskIds?.[0]).toBe('29')
  expect(bounded.workspace.tasks).toHaveLength(30)
  expect(bounded.workspace.tasks[0]?.messages).toEqual([])
  expect(bounded.workspace.tasks.at(-1)?.messages).toEqual(tasks.at(-1)?.messages)
  const huge = boundedSnapshotCache(
    snapshot(
      [
        {
          ...task('large'),
          messages: [{ id: 'huge', role: 'assistant', text: 'x'.repeat(9 * 1024 * 1024) }],
        },
      ],
      ['large'],
    ),
  )
  expect(huge.detailTaskIds).toEqual([])
  expect(huge.workspace.tasks[0]?.title).toBe('large')
})
it('retains cached history without restoring deleted tasks or overwriting fresh drafts and status', () => {
  const old = snapshot([{ ...task('a'), historyBefore: 'm60' }, task('deleted')])
  const shell = { ...task('a'), title: 'New title', draft: 'New draft', messages: [] }
  const next = snapshot([shell, { ...task('new'), messages: [] }], [])
  const cached = retainCachedThreads(old, next)
  expect(cached.workspace.tasks.map((task) => task.id)).toEqual(['a', 'new'])
  expect(cached.detailTaskIds).toEqual(['a'])
  expect(cached.workspace.tasks[0]).toMatchObject({
    title: 'New title',
    draft: 'New draft',
    messages: task('a').messages,
    historyBefore: 'm60',
  })
  expect(next.workspace.tasks[0]?.messages).toEqual([])
  const authoritative = snapshot([{ ...shell, messages: [] }], ['a'])
  expect(retainCachedThreads(cached, authoritative).workspace.tasks[0]?.messages).toEqual([])
})
it('keeps current file metadata and side-chat drafts when adding cached content', () => {
  const previous = task('a')
  previous.sideChats = [
    {
      id: 'chat',
      title: 'Chat',
      draft: 'old',
      createdAt: '2026-10-02',
      messages: [
        {
          id: 'q',
          question: 'Why?',
          answer: 'Because',
          status: 'completed',
          createdAt: '2026-10-02',
        },
      ],
    },
  ]
  const summary = {
    ...previous,
    files: [{ path: 'code.ts', viewed: true, before: '', after: '' }],
    sideChats: [{ ...previous.sideChats[0]!, draft: 'new draft', messages: [] }],
  }
  const combined = cachedThread(summary, previous)
  expect(combined.files).toEqual([{ ...previous.files[0], viewed: true }])
  expect(combined.sideChats?.[0]).toMatchObject({
    draft: 'new draft',
    messages: previous.sideChats[0]?.messages,
  })
})
it('retains message-owned turns beside latest-only summaries without double-counting budgets', () => {
  const turns: NonNullable<Task['turns']> = Array.from({ length: 4 }, (_, index) => ({
    id: `turn-${index}`,
    assistantId: `reply-${index}`,
    agentId: 'agent',
    provider: 'codex',
    model: 'model',
    status: 'completed',
    startedAt: `2026-10-02T12:0${index}:00Z`,
    finishedAt: `2026-10-02T12:0${index + 1}:00Z`,
    tokens: (index + 1) * 100,
    checkpoint: { before: `before-${index}`, after: `after-${index}`, files: [], omitted: [] },
  }))
  const previous: Task = {
    ...task('a'),
    turns: turns.slice(0, 3),
    messages: turns.slice(0, 3).map((turn) => ({
      id: turn.assistantId,
      role: 'assistant',
      text: turn.id,
    })),
    historyBefore: 'earlier-request',
  }
  const summary: Task = {
    ...previous,
    messages: [],
    turns: [{ ...turns[2]!, tokens: 350, checkpoint: undefined }],
    historyTotals: {
      tokens: 300,
      milliseconds: 120000,
      hasChanges: true,
      undoableTurnId: 'turn-1',
    },
  }
  const combined = cachedThread(summary, previous)
  expect(combined.turns?.map((turn) => turn.id)).toEqual(['turn-0', 'turn-1', 'turn-2'])
  expect(combined.turns?.[0]).toBe(previous.turns?.[0])
  expect(combined.turns?.[2]).toMatchObject({ tokens: 350, checkpoint: turns[2]!.checkpoint })
  expect(combined.messages).toBe(previous.messages)
  expect(combined.historyBefore).toBe(previous.historyBefore)
  expect(taskBudgetUsage(combined)).toEqual(taskBudgetUsage(summary))
  expect(combined.historyTotals).toEqual({
    tokens: 0,
    milliseconds: 0,
    hasChanges: true,
    undoableTurnId: 'turn-1',
  })
  // Repeated summary updates must subtract from fresh aggregate totals, not the adjusted cache.
  expect(taskBudgetUsage(cachedThread(summary, combined))).toEqual(taskBudgetUsage(summary))

  const latest = { ...turns[3]!, checkpoint: undefined }
  const advanced = {
    ...summary,
    turns: [latest],
    historyTotals: { tokens: 600, milliseconds: 180000, hasChanges: true },
  }
  const retained = cachedThread(advanced, previous)
  expect(retained.messages).toBe(previous.messages)
  expect(retained.messages.some((message) => message.id === latest.assistantId)).toBe(false)
  expect(retained.turns?.map((turn) => turn.id)).toEqual(turns.map((turn) => turn.id))
  expect(taskBudgetUsage(retained)).toEqual(taskBudgetUsage(advanced))
})
it('keeps budgets for unloaded turns and merges fresh checkpoint metadata', () => {
  const older = {
    id: 'older',
    assistantId: 'older-reply',
    agentId: 'agent',
    provider: 'codex' as const,
    model: 'model',
    status: 'completed' as const,
    startedAt: '2026-10-02T12:00:00Z',
    finishedAt: '2026-10-02T12:01:00Z',
    tokens: 100,
  }
  const owned = { ...older, id: 'owned', assistantId: 'not-retained', tokens: 200 }
  const latest = { ...older, id: 'latest', assistantId: 'reply', tokens: 300 }
  const previous: Task = {
    ...task('a'),
    messages: [
      ...task('a').messages,
      { id: 'prompt', role: 'user', text: 'Owned', turnId: owned.id },
    ],
    turns: [older, owned, { ...latest, checkpoint: { before: 'stale', files: [], omitted: [] } }],
  }
  const summary: Task = {
    ...previous,
    messages: [],
    turns: [{ ...latest, checkpoint: { before: 'fresh', files: [], omitted: [] } }],
    historyTotals: { tokens: 300, milliseconds: 120000, hasChanges: false },
  }
  const combined = cachedThread(summary, previous)
  expect(combined.turns?.map((turn) => turn.id)).toEqual(['owned', 'latest'])
  expect(combined.turns?.at(-1)?.checkpoint?.before).toBe('fresh')
  expect(combined.historyTotals).toEqual({ tokens: 100, milliseconds: 60000, hasChanges: false })
  expect(taskBudgetUsage(combined)).toEqual(taskBudgetUsage(summary))
  const unknown = cachedThread(
    { ...summary, historyTotals: { ...summary.historyTotals!, tokens: undefined } },
    {
      ...previous,
      turns: previous.turns?.map((turn) => ({ ...turn, tokens: undefined })),
    },
  )
  expect(unknown.historyTotals?.tokens).toBeUndefined()
})
it('invalidates cached running turns absent from a newer latest-only summary and its detail marker', () => {
  const running: NonNullable<Task['turns']>[number] = {
    id: 'running',
    assistantId: 'reply',
    agentId: 'agent',
    provider: 'codex',
    model: 'model',
    status: 'running',
    startedAt: '2026-10-02T12:00:00Z',
    tokens: 100,
  }
  const previous: Task = { ...task('a'), status: 'running', turns: [running] }
  const latest = {
    ...running,
    id: 'latest',
    assistantId: 'new-reply',
    startedAt: '2026-10-02T12:02:00Z',
    tokens: 300,
  }
  const summary: Task = {
    ...previous,
    status: 'review',
    messages: [],
    turns: [{ ...latest, status: 'completed', finishedAt: '2026-10-02T12:03:00Z' }],
    historyTotals: { tokens: 200, milliseconds: 120000, hasChanges: false },
  }
  expect(cachedThread(summary, previous)).toBe(summary)
  const retained = retainCachedThreads(snapshot([previous], ['a']), snapshot([summary], []))
  expect(retained.detailTaskIds).toEqual([])
  expect(retained.workspace.tasks[0]).toMatchObject({
    status: 'review',
    messages: [],
    turns: summary.turns,
    historyTotals: summary.historyTotals,
  })
  expect(taskBudgetUsage(retained.workspace.tasks[0]!)).toEqual(taskBudgetUsage(summary))

  // Legacy summaries include all turns, so their authoritative outcomes safely replace
  // cached running metadata and preserve the cached messages and loaded marker.
  const legacy: Task = {
    ...summary,
    turns: [
      { ...running, status: 'completed', finishedAt: '2026-10-02T12:02:00Z', tokens: 200 },
      ...summary.turns!,
    ],
    historyTotals: undefined,
  }
  const compatible = cachedThread(legacy, previous)
  expect(compatible.messages).toBe(previous.messages)
  expect(compatible.turns?.[0]).toMatchObject({ status: 'completed', tokens: 200 })
  expect(taskBudgetUsage(compatible)).toEqual(taskBudgetUsage(legacy))
  expect(
    retainCachedThreads(snapshot([previous], ['a']), snapshot([legacy], [])).detailTaskIds,
  ).toEqual(['a'])
  // A still-running latest turn remains authoritative when it is explicitly present.
  expect(cachedThread({ ...previous, messages: [] }, previous).messages).toBe(previous.messages)
})
it('invalidates cached content and its loaded marker when a summary reports removed history', () => {
  const previous = { ...task('a'), historyRevision: 0 }
  const summary = { ...previous, messages: [], historyRevision: 1 }
  expect(cachedThread(summary, previous)).toBe(summary)
  const retained = retainCachedThreads(snapshot([previous], ['a']), snapshot([summary], []))
  expect(retained.detailTaskIds).toEqual([])
  expect(retained.workspace.tasks[0]?.messages).toEqual([])
  expect(retained.workspace.tasks[0]?.historyRevision).toBe(1)
})
