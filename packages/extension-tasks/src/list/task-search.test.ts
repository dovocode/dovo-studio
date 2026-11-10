import { expect, it } from 'vite-plus/test'
import type { Task } from '@dovo/studio-core'
import {
  mergeMessageResults,
  messageResults,
  switcherResults,
  switcherThreadGroups,
} from './task-search'
import { collectTasks, type TaskEntry, type TaskSource } from './task-collection'
import { createTask } from '@dovo/studio-core'

const entry = (id: string, title: string, text: string, changes: Partial<Task> = {}): TaskEntry =>
  ({
    key: id,
    task: {
      id,
      title,
      createdAt: '2026-09-01T00:00:00Z',
      messages: [{ id: `${id}-m`, role: 'user', text }],
      ...changes,
    },
    source: { name: 'Studio Mac' },
    projectName: 'dovo',
  }) as unknown as TaskEntry

it('finds tasks by fuzzy title and puts archived ones last', () => {
  const entries = [
    entry('a', 'Fix login redirect', ''),
    entry('b', 'Fix logo', '', { archivedAt: '2026-09-02T00:00:00.000Z' }),
    entry('c', 'Write docs', ''),
  ]
  expect(switcherResults(entries, 'fix lo').map((item) => item.key)).toEqual(['a', 'b'])
  expect(switcherResults(entries, 'wdc').map((item) => item.key)).toEqual(['c'])
  expect(switcherResults(entries, 'studio').map((item) => item.key)).toEqual(['a', 'c', 'b'])
})

it('returns message snippets around the match', () => {
  const long = `${'x'.repeat(100)} the token refresh fails ${'y'.repeat(200)}`
  const [hit] = messageResults([entry('a', 'Auth', long)], 'Token refresh')
  expect(hit.messageId).toBe('a-m')
  expect(hit.snippet.startsWith('…')).toBe(true)
  expect(hit.snippet).toContain('token refresh fails')
  expect(messageResults([entry('a', 'Auth', long)], 'x')).toEqual([])
})

it('matches cached history with the runtime word and accent semantics', () => {
  const entries = [entry('a', 'One', 'Café is open'), entry('b', 'Two', 'A cafe open late')]
  expect(messageResults(entries, 'open café').map((hit) => hit.entry.key)).toEqual(['a', 'b'])
  expect(messageResults(entries, '"cafe open"').map((hit) => hit.entry.key)).toEqual(['b'])
})

it('ranks hits across computers before applying the global cap and keeps identities distinct', () => {
  const old = entry('computer-a:shared', 'Old', 'needle')
  const recent = entry('computer-b:shared', 'Recent', 'needle', {
    updatedAt: '2026-10-27T00:00:00Z',
  })
  const hits = Array.from({ length: 50 }, (_, index) => ({
    entry: old,
    messageId: String(index),
    snippet: 'old',
    role: 'user',
  }))
  const newer = { entry: recent, messageId: '0', snippet: 'new', role: 'assistant' }
  const result = mergeMessageResults([...hits, newer, { ...newer, snippet: 'cached' }])
  expect(result).toHaveLength(50)
  expect(result[0]).toEqual({ ...newer, snippet: 'cached' })
  expect(result[1]).toEqual(hits[0])
})

const searchTask = (id: string, title: string, changes: Partial<Task> = {}): Task => ({
  ...createTask({ title, repositoryId: '', agentId: '', objective: '' }),
  id,
  ...changes,
})
const searchSource = (runtimeId: string, tasks: Task[]): TaskSource => ({
  runtimeId,
  name: runtimeId,
  online: true,
  snapshot: null,
  workspace: {
    version: 1,
    runtimeAddress: '',
    repositories: [],
    agents: [],
    automations: [],
    tasks,
  },
})
it('ranks parent groups and reveals only matching children, with one limit per parent', () => {
  const tasks = [
    searchTask('parent', 'Release work'),
    ...Array.from({ length: 40 }, (_, index) =>
      searchTask(`child-${index}`, `Fix login ${index}`, {
        delegation: { parentTaskId: 'parent', parentRunId: 'run', key: String(index) },
      }),
    ),
    searchTask('other', 'Fix login independently'),
    searchTask('unrelated', 'Write docs', {
      delegation: { parentTaskId: 'parent', parentRunId: 'run', key: 'unrelated' },
    }),
  ]
  const entries = collectTasks([searchSource('mac', tasks)])
  const groups = switcherThreadGroups(entries, 'login', 2)
  expect(new Set(groups.map((group) => group.entry.task.id))).toEqual(new Set(['parent', 'other']))
  expect(
    groups.find((group) => group.entry.task.id === 'parent')?.matches.map((match) => match.task.id),
  ).toHaveLength(40)
  expect(
    switcherThreadGroups(entries, '')
      .map((group) => group.entry.task.id)
      .sort(),
  ).toEqual(['other', 'parent'])
  expect(switcherThreadGroups(entries, '').every((group) => !group.matches.length)).toBe(true)
})
it('resolves remote descendants without grouping a same-ID thread on another computer', () => {
  const entries = collectTasks([
    searchSource('mac', [searchTask('parent', 'Coordinator')]),
    searchSource('server', [
      searchTask('parent', 'Unrelated'),
      searchTask('child', 'Matching needle', {
        spawnParent: { runtimeId: 'mac', threadId: 'parent' },
      }),
      searchTask('nested', 'Needle follow-up', {
        delegation: { parentTaskId: 'child', parentRunId: 'run', key: 'nested' },
      }),
    ]),
  ])
  const [group] = switcherThreadGroups(entries, 'needle')
  expect(group.entry.key).toBe(JSON.stringify(['mac', 'parent']))
  expect(group.matches.map((match) => match.task.id).sort()).toEqual(['child', 'nested'])
})
