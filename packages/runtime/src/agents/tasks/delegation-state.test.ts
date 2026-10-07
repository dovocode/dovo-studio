import { expect, it } from 'vite-plus/test'
import type { Agent, Subagent, Task } from '@dovo/protocol'
import { projectDelegatedAgents } from './delegation-state'
const agents: Agent[] = [
  {
    id: 'agent',
    name: 'Agent',
    provider: 'claude',
    model: 'default',
    instructions: '',
    permission: 'ask',
    endpoint: '',
  },
]
function task(id: string, parentTaskId?: string): Task {
  return {
    id,
    title: id,
    repositoryId: 'repo',
    agentId: 'agent',
    status: 'done',
    createdAt: '2026-10-01T00:00:00Z',
    messages: [{ id: `${id}-prompt`, role: 'user', text: `Prompt ${id}` }],
    files: [],
    draft: '',
    example: false,
    ...(parentTaskId ? { delegation: { parentTaskId, parentRunId: 'run', key: id } } : {}),
  }
}
const native: Subagent = {
  id: 'provider-native',
  provider: 'claude',
  name: 'Explore',
  status: 'completed',
  startedAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
}
it('drops Dovo child records when children are deleted and keeps provider-native records', () => {
  const first = projectDelegatedAgents(
    [{ ...task('parent'), subagents: [native] }, task('a', 'parent'), task('b', 'parent')],
    agents,
  )
  const parent = first[0]
  expect(parent.subagents?.map((record) => record.id)).toEqual(['provider-native', 'a', 'b'])
  expect(parent.subagents?.filter((record) => record.source === 'dovo')).toHaveLength(2)
  const afterOne = projectDelegatedAgents([parent, first[2]], agents)
  expect(afterOne[0].subagents?.map((record) => record.id)).toEqual(['provider-native', 'b'])
  const afterAll = projectDelegatedAgents([afterOne[0]], agents)
  expect(afterAll[0].subagents).toEqual([native])
  const children = new Set(afterAll.map((item) => item.id))
  const dangling = (afterAll[0].subagents ?? []).filter(
    (record) => record.source === 'dovo' && !children.has(record.taskId ?? ''),
  )
  expect(dangling).toEqual([])
})
it('removes a stale Dovo record even when no delegated tasks remain anywhere', () => {
  const stale: Subagent = {
    ...native,
    id: 'gone',
    source: 'dovo',
    taskId: 'gone',
  }
  const projected = projectDelegatedAgents([{ ...task('parent'), subagents: [stale] }], agents)
  expect(projected[0].subagents).toEqual([])
})
it('returns the same parent object when nothing changed', () => {
  const tasks = [task('parent'), task('a', 'parent')]
  const once = projectDelegatedAgents(tasks, agents)
  const twice = projectDelegatedAgents(once, agents)
  expect(twice[0]).toBe(once[0])
  const plain = projectDelegatedAgents([task('solo')], agents)
  expect(plain[0].subagents).toBeUndefined()
})
