import { expect, it } from 'vite-plus/test'
import { decode } from '../../shared/schema.js'
import { workspaceSchema } from '../../workspace.js'
import { retainWorkspace } from './retain-workspace.js'

const workspace = () =>
  decode(workspaceSchema, {
    version: 1,
    runtimeAddress: '',
    agents: [],
    repositories: [],
    automations: [],
    tasks: ['one', 'two'].map((id) => ({
      id,
      title: id,
      repositoryId: 'repo',
      agentId: 'agent',
      status: 'draft',
      createdAt: '2026-10-01',
      messages: [{ id: `${id}-reply`, role: 'assistant', text: 'Original' }],
      files: [],
      draft: '',
      example: false,
    })),
  })
it('preserves unchanged entities and collections when a different thread streams', () => {
  const previous = workspace(),
    next = workspace()
  next.tasks[1]!.messages[0]!.text = 'Updated'
  const retained = retainWorkspace(previous, next)
  expect(retained.tasks[0]).toBe(previous.tasks[0])
  expect(retained.tasks[1]).toBe(next.tasks[1])
  expect(retained.agents).toBe(previous.agents)
  expect(retained.repositories).toBe(previous.repositories)
  expect(previous.tasks[1]!.messages[0]!.text).toBe('Original')
  expect(next.tasks[0]).not.toBe(previous.tasks[0])
})
it('retains an unchanged workspace but keeps reorder, addition and deletion authoritative', () => {
  const previous = workspace()
  expect(retainWorkspace(previous, workspace())).toBe(previous)
  const reordered = workspace()
  reordered.tasks.reverse()
  expect(retainWorkspace(previous, reordered).tasks).toEqual(reordered.tasks)
  expect(retainWorkspace(previous, reordered).tasks[0]).toBe(previous.tasks[1])
  const removed = workspace()
  removed.tasks.pop()
  expect(retainWorkspace(previous, removed).tasks).toHaveLength(1)
  expect(retainWorkspace(removed, previous).tasks).toHaveLength(2)
})
it('detects changes and removal of optional fields and metadata', () => {
  const previous = workspace(),
    next = workspace()
  previous.tasks[0]!.pinned = true
  expect(retainWorkspace(previous, next).tasks[0]).toBe(next.tasks[0])
  next.runtimeAddress = 'http://runtime.local:8787'
  expect(retainWorkspace(previous, next).runtimeAddress).toBe(next.runtimeAddress)
  previous.planLimits = [
    { provider: 'codex', window: 'weekly', usedPercent: 25, updatedAt: '2026-10-01' },
  ]
  expect(retainWorkspace(previous, next).planLimits).toBeUndefined()
})
