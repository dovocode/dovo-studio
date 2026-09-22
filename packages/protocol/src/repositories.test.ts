import { expect, it } from 'vitest'
import { addRepositorySchema, githubRepositorySchema } from './repositories.js'

it.each(['owner/repo', ' https://github.com/owner/repo.git ', 'https://github.com/owner/repo/'])(
  'normalizes a GitHub repository: %s',
  (value) => {
    expect(githubRepositorySchema.parse(value)).toEqual({
      name: 'repo',
      url: 'https://github.com/owner/repo.git',
    })
  },
)

it.each([
  '',
  '../..',
  'owner/..',
  'owner/.',
  'owner/repo/tree/main',
  'https://evil.test/owner/repo',
  'https://github.com@evil.test/owner/repo',
  'https://token@github.com/owner/repo',
  'file:///tmp/repo',
  'git@github.com:owner/repo',
  'owner/repo?token=secret',
  'owner/repo#main',
  '--help',
  'owner/repo\\escape',
])('rejects unsafe or unsupported clone input: %s', (value) => {
  expect(githubRepositorySchema.safeParse(value).success).toBe(false)
})

it('validates the selected source, trims names and preserves exact folder paths', () => {
  expect(
    addRepositorySchema.parse({ source: 'local', name: ' Project ', path: ' ~/Code/project ' }),
  ).toEqual({ source: 'local', name: 'Project', path: ' ~/Code/project ' })
  expect(
    addRepositorySchema.safeParse({ source: 'github', name: 'Project', repository: 'owner/repo' })
      .success,
  ).toBe(false)
  expect(addRepositorySchema.safeParse({ source: 'local', name: ' ', path: '/tmp' }).success).toBe(
    false,
  )
  expect(
    addRepositorySchema.safeParse({ source: 'local', name: 'Project', path: '/tmp\0bad' }).success,
  ).toBe(false)
})
