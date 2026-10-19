import { expect, it } from 'vite-plus/test'
import { decode } from './shared/schema'
import {
  projectIcon,
  projectIconColor,
  projectIconInitials,
  repositorySchema,
  taskDisplayProject,
} from './workspace'

it('uses the project override for every task and falls back to its discovered icon', () => {
  const repository = decode(repositorySchema, {
    id: 'repo',
    name: 'App',
    path: '/app',
    branch: 'main',
    discoveredIcon: 'data:image/png;base64,YQ==',
  })
  expect(projectIcon(repository)).toBe(repository.discoveredIcon)
  expect(projectIcon({ ...repository, iconOverride: 'data:image/png;base64,Yg==' })).toBe(
    'data:image/png;base64,Yg==',
  )
})

it('keeps a distinct fallback color stable for each project ID', () => {
  const repository = decode(repositorySchema, {
    id: 'a00f0cb4-a628-4796-b404-68c688bd90a7',
    name: 'App',
    path: '/app',
    branch: 'main',
  })
  expect(projectIconColor(repository)).toMatch(/^#[0-9a-f]{6}$/)
  expect(projectIconColor({ ...repository, name: 'Renamed' })).toBe(projectIconColor(repository))
  expect(projectIconColor({ ...repository, id: 'def94854-49b4-4d40-a360-7322681fb3c7' })).not.toBe(
    projectIconColor(repository),
  )
})

it('uses Git identity for consistent colours and initials across machines', () => {
  const repository = decode(repositorySchema, {
    id: 'one',
    name: 'My checkout',
    path: '/app',
    branch: 'main',
    gitIdentity: 'github.com/team/project',
  })
  const other = { ...repository, id: 'two', name: 'Work app', path: '/other' }
  expect(projectIconColor(other)).toBe(projectIconColor(repository))
  expect(projectIconInitials(other)).toBe('PR')
  expect(projectIconInitials(repository)).toBe('PR')
})

it('uses only the first linked project as General thread display context', () => {
  const general = decode(repositorySchema, {
    id: 'general',
    kind: 'scratch',
    name: 'General',
    path: '/general',
    branch: '',
  })
  const first = decode(repositorySchema, {
    id: 'first',
    name: 'First project',
    path: '/first',
    branch: 'main',
    iconOverride: 'data:image/png;base64,YQ==',
  })
  const second = { ...first, id: 'second', name: 'Second project' }
  const repositories = [general, first, second]
  const link = (repositoryId: string) => ({
    id: repositoryId,
    repositoryId,
    execution: 'main' as const,
    access: 'read-only' as const,
  })
  const task = { repositoryId: 'general', linkedCheckouts: [link('first'), link('second')] }
  expect(taskDisplayProject(task, repositories)).toBe(first)
  expect(projectIcon(taskDisplayProject(task, repositories))).toBe(first.iconOverride)
  expect(taskDisplayProject({ ...task, repositoryId: 'second' }, repositories)).toBe(second)
  expect(taskDisplayProject({ ...task, linkedCheckouts: [] }, repositories)).toBe(general)
  expect(
    taskDisplayProject(
      { ...task, linkedCheckouts: [link('missing'), link('second')] },
      repositories,
    ),
  ).toBe(general)
  expect(
    taskDisplayProject({ ...task, pendingLinkedCheckouts: [link('second')] }, repositories),
  ).toBe(second)
  expect(taskDisplayProject({ ...task, pendingLinkedCheckouts: [] }, repositories)).toBe(general)
  expect(task.repositoryId).toBe('general')
})
