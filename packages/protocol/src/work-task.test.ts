import { decodeResult, decode } from './schema.js'
import { expect, it } from 'vitest'
import { taskWorkItemSchema, workTaskInputSchema } from './work-task.js'
const request = {
  repositoryId: 'repo',
  kind: 'issue',
  id: 'APP-7',
  url: 'https://team.atlassian.net/browse/APP-7',
  revision: '5',
  requestId: 'fd7e2349-4f68-4208-bfdb-343cae89ec35',
}
it('requires a captured revision and stable request ID for issue task creation', () => {
  expect(decodeResult(workTaskInputSchema, request).success).toBe(true)
  expect(
    decodeResult(workTaskInputSchema, {
      ...request,
      revision: undefined,
    }).success,
  ).toBe(false)
  expect(
    decodeResult(workTaskInputSchema, {
      ...request,
      requestId: 'random-label',
    }).success,
  ).toBe(false)
})
it.each(['javascript:alert(1)', 'https://user:secret@host.test/issues/1'])(
  'rejects unsafe source URLs: %s',
  (url) => {
    expect(
      decodeResult(workTaskInputSchema, {
        ...request,
        url,
      }).success,
    ).toBe(false)
  },
)
it('supports Jira issue sources but excludes Jira pipeline sources', () => {
  const issue = {
    kind: 'issue',
    provider: 'jira',
    id: request.id,
    title: 'Fix',
    url: request.url,
    revision: '5',
  }
  expect(decodeResult(taskWorkItemSchema, issue).success).toBe(true)
  expect(
    decodeResult(taskWorkItemSchema, {
      ...issue,
      kind: 'pipeline',
      ref: 'main',
      sha: '',
    }).success,
  ).toBe(false)
})
it('keeps Jira source separate from the required task execution project', () => {
  expect(
    decode(workTaskInputSchema, {
      ...request,
      jiraSourceId: 'planning',
    }),
  ).toMatchObject({
    repositoryId: 'repo',
    jiraSourceId: 'planning',
  })
  expect(
    decodeResult(workTaskInputSchema, {
      ...request,
      jiraSourceId: 'planning',
      repositoryId: undefined,
    }).success,
  ).toBe(false)
})
