import { expect, it } from 'vite-plus/test'
import type { Task, Subagent } from '../index.js'
import {
  taskFamilyIds,
  taskFamilyInputIds,
  taskSubagents,
  indexTaskSubagents,
  taskFamilyWorking,
  taskFamilyRunToken,
} from './delegation.js'

const task = (id: string, parentTaskId?: string): Task => ({
  id,
  title: id,
  agentId: '',
  repositoryId: '',
  status: 'draft',
  createdAt: '',
  draft: '',
  example: false,
  messages: [],
  files: [],
  ...(parentTaskId ? { delegation: { parentTaskId, parentRunId: 'attempt', key: id } } : {}),
})
const agent = (id: string, status: Subagent['status'] = 'working'): Subagent => ({
  id,
  taskId: id,
  source: 'dovo',
  name: id,
  provider: 'codex',
  status,
  startedAt: '',
  updatedAt: '',
})
it('collects the complete descendant family without including unrelated threads or looping', () => {
  const tasks = [task('parent'), task('child', 'parent'), task('nested', 'child'), task('other')]
  expect(taskFamilyIds(tasks, 'parent')).toEqual(new Set(['parent', 'child', 'nested']))
  tasks[0] = task('parent', 'nested')
  expect(taskFamilyIds(tasks, 'parent')).toEqual(new Set(['parent', 'child', 'nested']))
})
it('keeps nested and exited agents in the agents overview and drops missing task links', () => {
  const parent = { ...task('parent'), subagents: [agent('child'), agent('missing')] }
  const child = { ...task('child', 'parent'), subagents: [agent('nested', 'completed')] }
  const tasks = [parent, child, task('nested', 'child'), task('other')]
  expect(taskSubagents(parent, tasks).map((record) => record.id)).toEqual(['child', 'nested'])
  expect(taskSubagents(parent, tasks).filter((record) => record.status === 'working')).toEqual([
    agent('child'),
  ])
})
it('indexes a snapshot once while keeping each family and newer snapshot independent', () => {
  const parent = { ...task('parent'), subagents: [agent('child')] }
  const child = task('child', parent.id)
  const other = { ...task('other'), subagents: [agent('other-child')] }
  const tasks = [parent, child, other, task('other-child', other.id)]
  const indexed = indexTaskSubagents(tasks)
  expect(indexed(parent)).toEqual([agent('child')])
  expect(indexed(other)).toEqual([agent('other-child')])
  const newer = indexTaskSubagents(tasks.filter((entry) => entry.id !== child.id))
  expect(newer(parent)).toEqual([])
  expect(indexed(parent)).toEqual([agent('child')])
})
it('hides native workers whose owning run ended while retaining a working Dovo descendant', () => {
  const parent = {
    ...task('parent'),
    status: 'review' as const,
    subagents: [agent('child'), { ...agent('native'), source: undefined, taskId: undefined }],
  }
  const child = {
    ...task('child', parent.id),
    status: 'running' as const,
    subagents: [{ ...agent('nested-native'), source: undefined, taskId: undefined }],
  }
  const indexed = indexTaskSubagents([parent, child])
  expect(indexed(parent).map((record) => record.id)).toEqual(['child', 'native', 'nested-native'])
  expect(indexed(parent, true).map((record) => record.id)).toEqual(['child', 'nested-native'])
})

it('keeps live native agents in an idle thread and drops liveness when the provider disconnects', () => {
  const native: Subagent = {
    ...agent('native'),
    source: undefined,
    taskId: undefined,
    sessionLive: true,
  }
  const parent: Task = { ...task('parent'), status: 'review', subagents: [native] }
  expect(taskSubagents(parent, [parent], true)).toEqual([native])
  const closed: Task = { ...parent, subagents: [{ ...native, sessionLive: false }] }
  expect(taskSubagents(closed, [closed], true)).toEqual([])
})

it('holds the full family for native work and pending results and guards native stop snapshots', () => {
  const native: Subagent = {
    ...agent('native'),
    source: undefined,
    taskId: undefined,
    sessionId: 'session',
    sessionLive: true,
    status: 'unknown',
  }
  const parent = { ...task('parent'), status: 'review' as const }
  const child = { ...task('child', 'parent'), status: 'review' as const, subagents: [native] }
  const before = [parent, child]
  expect(taskFamilyWorking(before, parent.id)).toBe(true)
  expect(taskSubagents(parent, before, true)).toEqual([native])
  const pending = {
    ...child,
    subagents: [
      {
        ...native,
        status: 'completed' as const,
        finishedAt: 'now',
        completion: 'pending' as const,
        completionId: 'result',
      },
    ],
  }
  expect(taskFamilyWorking([parent, pending], parent.id)).toBe(true)
  const settled = {
    ...pending,
    subagents: [{ ...pending.subagents[0], completion: 'read' as const }],
  }
  expect(taskFamilyWorking([parent, settled], parent.id)).toBe(false)
  expect(taskFamilyRunToken(before, parent.id)).not.toBe(
    taskFamilyRunToken([parent, pending], parent.id),
  )
})

it('changes the stop guard when a native child is reused in the same session', () => {
  const native: Subagent = {
    ...agent('native'),
    source: undefined,
    sessionId: 'session',
    sessionLive: true,
    startedAt: 'first',
  }
  const parent = { ...task('parent'), status: 'review' as const, subagents: [native] }
  const newer = { ...parent, subagents: [{ ...native, startedAt: 'second' }] }
  expect(taskFamilyRunToken([parent], parent.id)).not.toBe(taskFamilyRunToken([newer], parent.id))
})

it('surfaces nested child input on ancestors without crossing independent families or looping', () => {
  const tasks = [task('root'), task('child', 'root'), task('nested', 'child'), task('other')]
  expect(taskFamilyInputIds(tasks, ['nested'])).toEqual(new Set(['nested', 'child', 'root']))
  tasks[0] = task('root', 'nested')
  expect(taskFamilyInputIds(tasks, ['nested', 'other'])).toEqual(
    new Set(['nested', 'child', 'root', 'other']),
  )
})
