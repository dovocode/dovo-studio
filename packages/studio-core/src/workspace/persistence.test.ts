import { expect, it } from 'vitest'
import { createWorkspace } from './seed'
import { decodeWorkspace, encodeWorkspace } from './persistence'
it('round trips drafts, configurations and workflow positions', () => {
  const workspace = createWorkspace()
  workspace.tasks.push({
    id: 'real',
    title: 'My task',
    repositoryId: 'studio',
    agentId: 'builder',
    status: 'draft',
    createdAt: new Date().toISOString(),
    draft: 'Remember this across reloads',
    messages: [],
    files: [],
    example: false,
  })
  workspace.agents[0].reasoning = 'high'
  expect(decodeWorkspace(encodeWorkspace(workspace))).toEqual(workspace)
})
it('rejects incompatible saved data instead of silently overwriting it', () => {
  expect(() => decodeWorkspace('{"version":2}')).toThrow(Error)
  expect(() => decodeWorkspace('broken')).toThrow(Error)
})

it('starts without dummy chats and removes only marked examples from saved workspaces', () => {
  const workspace = createWorkspace()
  expect(workspace.tasks).toEqual([])
  const task = {
    id: 'real',
    title: 'My task',
    repositoryId: 'studio',
    agentId: 'builder',
    status: 'draft' as const,
    createdAt: '',
    draft: 'Keep my draft',
    messages: [],
    files: [],
    example: false,
  }
  workspace.tasks.push(task, { ...task, id: 'welcome', example: true })
  expect(decodeWorkspace(JSON.stringify(workspace)).tasks).toEqual([task])
})
