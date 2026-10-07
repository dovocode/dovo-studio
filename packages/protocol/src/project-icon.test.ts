import { expect, it } from 'vite-plus/test'
import { decode } from './shared/schema'
import { projectIcon, projectIconColor, projectIconInitials, repositorySchema } from './workspace'

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
