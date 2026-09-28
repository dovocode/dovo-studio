import { expect, it } from 'vitest'
import { decode } from './shared/schema'
import { projectIcon, repositorySchema } from './workspace'

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
