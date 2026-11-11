import { expect, it } from 'vite-plus/test'
import { requestNeedsWorkspaceSync, requestReadWorkspaceDependency } from './request-ordering'

it('lets pure reads and Stop proceed while preserving barriers for writes and unknown routes', () => {
  for (const path of [
    '/api/scm/pulls/detail',
    '/api/scm/source/identity',
    '/api/scm/work/issues/list',
    '/api/tasks/history',
    '/api/tasks/cancel',
  ])
    expect(requestNeedsWorkspaceSync(path)).toBe(false)
  expect(requestNeedsWorkspaceSync('/api/snapshot', 'GET')).toBe(false)
  for (const path of [
    '/api/tasks/message',
    '/api/agents/settings/save',
    '/api/scm/pulls/action',
    '/api/new-route',
  ])
    expect(requestNeedsWorkspaceSync(path)).toBe(true)
  expect(requestNeedsWorkspaceSync('/api/workspace', 'PATCH')).toBe(true)
})

it('keeps project and thread prerequisites for pure reads', () => {
  expect(
    requestReadWorkspaceDependency('/api/scm/pulls/detail', { repositoryId: 'project' }),
  ).toEqual({ repositoryId: 'project', taskId: undefined })
  expect(requestReadWorkspaceDependency('/api/tasks/history', { id: 'thread' })?.taskId).toBe(
    'thread',
  )
  expect(requestReadWorkspaceDependency('/api/tasks/cancel', { id: 'thread' })).toBeUndefined()
  expect(
    requestReadWorkspaceDependency('/api/new-route', { repositoryId: 'project' }),
  ).toBeUndefined()
})
