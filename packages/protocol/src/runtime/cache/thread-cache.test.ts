import { expect, it } from 'vite-plus/test'
import { cachedThread, retainCachedThreads } from './thread-cache.js'
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
it('retains cached history without restoring deleted tasks or overwriting fresh drafts and status', () => {
  const old = snapshot([task('a'), task('deleted')])
  const shell = { ...task('a'), title: 'New title', draft: 'New draft', messages: [] }
  const next = snapshot([shell, { ...task('new'), messages: [] }], [])
  const cached = retainCachedThreads(old, next)
  expect(cached.workspace.tasks.map((task) => task.id)).toEqual(['a', 'new'])
  expect(cached.detailTaskIds).toEqual(['a'])
  expect(cached.workspace.tasks[0]).toMatchObject({
    title: 'New title',
    draft: 'New draft',
    messages: task('a').messages,
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
