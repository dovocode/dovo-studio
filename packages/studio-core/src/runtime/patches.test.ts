import { expect, it } from 'vitest'
import { createWorkspace } from '../workspace/seed'
import { updateTask } from '../workspace/actions'
import { decode, taskSchema } from '@dovo/protocol'
import { workspacePatches } from './patches'

it('creates a draft-only patch without serializing unchanged message history', () => {
  const task = decode(taskSchema, {
    id: 't',
    title: 'Task',
    repositoryId: '',
    agentId: '',
    status: 'draft',
    createdAt: '',
    messages: [],
    files: [],
    draft: '',
    example: false,
  })
  const messages = task.messages
  Object.defineProperty(messages, 'toJSON', {
    value: () => {
      throw new Error('Unchanged history must not be serialized')
    },
  })
  const before = { ...createWorkspace(), tasks: [task] }
  const after = updateTask(before, 't', (t) => ({ ...t, draft: 'Hello' }))
  expect(workspacePatches(before, after)).toEqual([
    { collection: 'tasks', id: 't', changes: { draft: { before: '', after: 'Hello' } } },
  ])
  expect(workspacePatches(before, before)).toEqual([])
})

it('ignores structurally equal replacements but detects changed message history', () => {
  const task = decode(taskSchema, {
    id: 't',
    title: 'Task',
    repositoryId: '',
    agentId: '',
    status: 'draft',
    createdAt: '',
    messages: [],
    files: [],
    draft: '',
    example: false,
  })
  const before = { ...createWorkspace(), tasks: [task] }
  expect(
    workspacePatches(
      before,
      updateTask(before, 't', (t) => ({ ...t, messages: [] })),
    ),
  ).toEqual([])
  const messages = [{ id: 'm', role: 'user' as const, text: 'Hello' }]
  expect(
    workspacePatches(
      before,
      updateTask(before, 't', (t) => ({ ...t, messages })),
    )[0].changes,
  ).toEqual({ messages: { before: [], after: messages } })
})
