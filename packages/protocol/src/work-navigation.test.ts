import { expect, it } from 'vitest'
import { decodeWorkTarget, encodeWorkTarget } from './work-navigation.js'

it('opens Jira issue targets independently of a destination project', () => {
  const target = {
    jiraSourceId: 'planning',
    id: 'TEAM-1',
    url: 'https://team.atlassian.net/browse/TEAM-1',
  }
  expect(decodeWorkTarget(encodeWorkTarget(target))).toEqual(target)
  expect(decodeWorkTarget(encodeWorkTarget({ repositoryId: 'repo', id: '1' }))).toEqual({
    repositoryId: 'repo',
    id: '1',
  })
})
it('rejects ambiguous or absent issue source identity', () => {
  expect(decodeWorkTarget(JSON.stringify({ id: '1' }))).toBeUndefined()
  expect(
    decodeWorkTarget(JSON.stringify({ repositoryId: 'repo', jiraSourceId: 'planning', id: '1' })),
  ).toBeUndefined()
})
