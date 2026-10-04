import { expect, it } from 'vite-plus/test'
import { decode, taskSchema } from '@dovo/protocol'
import { projectActivity } from './project-order'
it('orders summary-only tasks by last user prompt independently of agent activity', () => {
  const task = decode(taskSchema, {
    id: 'task',
    title: 'Work',
    agentId: 'agent',
    repositoryId: 'repo',
    status: 'review',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-04T00:00:00Z',
    lastPromptAt: '2026-10-02T00:00:00Z',
    messages: [],
    files: [],
    draft: '',
    example: false,
  })
  expect(projectActivity([task], 'repo', 'user-message')).toBe(Date.parse(task.lastPromptAt ?? ''))
  expect(projectActivity([task], 'repo', 'activity')).toBe(Date.parse(task.updatedAt ?? ''))
  expect(projectActivity([task], 'other', 'activity')).toBe(0)
  expect(projectActivity([{ ...task, example: true }], 'repo', 'activity')).toBe(0)
})
