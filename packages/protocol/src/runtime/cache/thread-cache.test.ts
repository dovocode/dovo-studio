import { expect, it } from 'vite-plus/test'
import { cachedThread, retainCachedThreads, boundedSnapshotCache } from './thread-cache.js'
import { decode } from '../../shared/schema.js'
import { snapshotSchema } from '../connection/runtime.js'
import type { Task } from '../../workspace.js'
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
it('invalidates cached content and its loaded marker when a summary reports removed history', () => {
  const previous = { ...task('a'), historyRevision: 0 }
  const summary = { ...previous, messages: [], historyRevision: 1 }
  expect(cachedThread(summary, previous)).toBe(summary)
  const retained = retainCachedThreads(snapshot([previous], ['a']), snapshot([summary], []))
  expect(retained.detailTaskIds).toEqual([])
  expect(retained.workspace.tasks[0]?.messages).toEqual([])
  expect(retained.workspace.tasks[0]?.historyRevision).toBe(1)
})
