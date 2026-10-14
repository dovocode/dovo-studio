import { expect, it } from 'vite-plus/test'
import { decode, decodeResult } from '../../shared/schema'
import { forgeSourceIdentityQuerySchema, forgeSourceIdentitySchema } from './source-identity'
import { pullActionSchema, pullCreateSchema, pullCreateOptionsSchema } from './forges'
import { pullLineCommentSchema, pullTaskInputSchema } from '../pulls/pulls'
import {
  forgeWorkQuerySchema,
  forgeIssueActionSchema,
  forgeIssueCreateSchema,
  forgePipelineActionSchema,
} from './forge-work'

it('requires exactly one identity source and permits URL-only explicit account selection', () => {
  expect(decodeResult(forgeSourceIdentityQuerySchema, {}).success).toBe(false)
  expect(
    decodeResult(forgeSourceIdentityQuerySchema, { repositoryId: 'repo', jiraSourceId: 'jira' })
      .success,
  ).toBe(false)
  const url = `https://github.com/${'owner'.repeat(40)}/project/pull/7`
  expect(
    decode(forgeSourceIdentityQuerySchema, { repositoryId: url, connectionId: 'account' }),
  ).toEqual({ repositoryId: url, connectionId: 'account' })
  expect(decode(forgeSourceIdentityQuerySchema, { jiraSourceId: 'jira' })).toEqual({
    jiraSourceId: 'jira',
  })
  expect(
    decodeResult(forgeSourceIdentitySchema, { readerIdentity: '', destination: 'destination' })
      .success,
  ).toBe(false)
})
it('preserves destination/account guards at PR mutation schema boundaries while permitting legacy inputs', () => {
  const guard = { expectedDestination: 'opaque-destination', connectionId: 'explicit-account' }
  const action = { action: 'comment', number: 7, headSha: 'a'.repeat(40), body: 'Keep draft' }
  expect(decode(pullActionSchema, { ...action, ...guard })).toMatchObject(guard)
  expect(decode(pullActionSchema, action)).not.toHaveProperty('expectedDestination')
  expect(
    decode(pullCreateSchema, {
      title: 'Next',
      head: 'feature',
      base: 'main',
      expectedDestination: guard.expectedDestination,
    }),
  ).toMatchObject({ expectedDestination: guard.expectedDestination })
  expect(
    decode(pullCreateOptionsSchema, {
      provider: 'github',
      draft: true,
      destination: guard.expectedDestination,
    }),
  ).toHaveProperty('destination', guard.expectedDestination)
  expect(
    decode(pullLineCommentSchema, {
      ...guard,
      number: 7,
      headSha: 'a'.repeat(40),
      path: 'file.ts',
      side: 'additions',
      start: 1,
      end: 1,
      body: 'Draft',
    }),
  ).toMatchObject(guard)
  expect(
    decode(pullTaskInputSchema, {
      number: 7,
      headSha: 'a'.repeat(40),
      objective: 'Implement',
      expectedDestination: guard.expectedDestination,
    }),
  ).toHaveProperty('expectedDestination', guard.expectedDestination)
})
it('preserves reader and destination guards across issue and pipeline operations', () => {
  const expectedDestination = 'destination'
  expect(
    decode(forgeWorkQuerySchema, { expectedDestination, expectedReaderIdentity: 'reader' }),
  ).toMatchObject({ expectedDestination, expectedReaderIdentity: 'reader' })
  expect(
    decode(forgeIssueCreateSchema, { title: 'Issue', body: '', expectedDestination }),
  ).toHaveProperty('expectedDestination', expectedDestination)
  for (const input of [
    { action: 'comment', id: '1', revision: 'same', body: 'Draft' },
    { action: 'edit', id: '1', revision: 'same', title: 'Changed' },
  ])
    expect(decode(forgeIssueActionSchema, { ...input, expectedDestination })).toHaveProperty(
      'expectedDestination',
      expectedDestination,
    )
  for (const input of [
    { action: 'run', definition: '1', ref: 'main' },
    ...['rerun', 'cancel', 'enable', 'disable'].map((action) => ({ action, id: '1' })),
  ])
    expect(decode(forgePipelineActionSchema, { ...input, expectedDestination })).toHaveProperty(
      'expectedDestination',
      expectedDestination,
    )
})
