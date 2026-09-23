import { decode, decodeResult } from './schema.js'
import { expect, it } from 'vitest'
import { addRepositorySchema, githubRepositorySchema } from './repositories.js'
it.each(['owner/repo', ' https://github.com/owner/repo.git ', 'https://github.com/owner/repo/'])(
  'normalizes a GitHub repository: %s',
  (value) => {
    expect(decode(githubRepositorySchema, value)).toEqual({
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
  expect(decodeResult(githubRepositorySchema, value).success).toBe(false)
})
it('validates the selected source, trims names and preserves exact folder paths', () => {
  expect(
    decode(addRepositorySchema, {
      source: 'local',
      name: ' Project ',
      path: ' ~/Code/project ',
    }),
  ).toEqual({
    source: 'local',
    name: 'Project',
    path: ' ~/Code/project ',
  })
  expect(
    decodeResult(addRepositorySchema, {
      source: 'github',
      name: 'Project',
      repository: 'owner/repo',
    }).success,
  ).toBe(false)
  expect(
    decodeResult(addRepositorySchema, {
      source: 'local',
      name: ' ',
      path: '/tmp',
    }).success,
  ).toBe(false)
  expect(
    decodeResult(addRepositorySchema, {
      source: 'local',
      name: 'Project',
      path: '/tmp\0bad',
    }).success,
  ).toBe(false)
})
