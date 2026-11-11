import { expect, it } from 'vite-plus/test'
import { Effect, Schema } from 'effect'
import {
  conditionalReadSchema,
  decode,
  forgeIssueDetailSchema,
  mutableStruct,
} from '@dovo/protocol'
import { jiraReader } from './jira-reads'

const issue = decode(forgeIssueDetailSchema, {
  issue: {
    id: 'TEAM-1',
    title: 'Private work',
    body: 'Description',
    state: 'Open',
    url: 'https://team.atlassian.net/browse/TEAM-1',
    author: 'Dominic',
    assignees: [],
    labels: [],
    updatedAt: 'v1',
    revision: 'v1',
  },
  comments: [],
})
const input = {
  jiraSourceId: 'jira',
  id: 'TEAM-1',
  section: 'overview',
  expectedReaderIdentity: 'account',
  expectedDestination: 'destination',
}
const querySchema = mutableStruct({
  knownVersion: Schema.optional(Schema.String),
  conditional: Schema.Boolean,
  refresh: Schema.Boolean,
})
it('shares guarded reads and preserves the exact live object on unchanged replies', async () => {
  const calls: unknown[] = []
  const read = jiraReader({}, 'paired-runtime', (path, input, schema) =>
    Effect.sync(() => {
      calls.push({ path, input })
      const query = decode(querySchema, input)
      return decode(
        schema,
        query.knownVersion
          ? { unchanged: true, readVersion: query.knownVersion }
          : { value: issue, readVersion: 'a'.repeat(64) },
      )
    }),
  )
  const [first, second] = await Promise.all([
    Effect.runPromise(read('/api/scm/work/issues/detail', input, forgeIssueDetailSchema)),
    Effect.runPromise(read('/api/scm/work/issues/detail', input, forgeIssueDetailSchema)),
  ])
  expect(calls).toHaveLength(1)
  expect(second).toBe(first)
  // A forced read reaches the runtime even inside the short reuse window.
  expect(
    await Effect.runPromise(
      read('/api/scm/work/issues/detail', { ...input, refresh: true }, forgeIssueDetailSchema),
    ),
  ).toBe(first)
  expect(calls).toHaveLength(2)
  expect(calls[1]).toMatchObject({
    input: { conditional: true, refresh: true, knownVersion: 'a'.repeat(64) },
  })
  for (const changed of [
    { expectedReaderIdentity: 'new-account' },
    { expectedDestination: 'new-project' },
    { section: 'discussion' },
    { cursor: '30' },
  ]) {
    const value = await Effect.runPromise(
      read('/api/scm/work/issues/detail', { ...input, ...changed }, forgeIssueDetailSchema),
    )
    expect(value).not.toBe(first)
    expect(calls.at(-1)).toMatchObject({ input: { knownVersion: undefined } })
  }
})
it('accepts legacy runtime replies but revalidates the next open', async () => {
  let calls = 0
  const read = jiraReader({}, 'runtime', (_path, _input, schema) =>
    Effect.sync(() => {
      calls++
      return decode(schema, issue)
    }),
  )
  await Effect.runPromise(read('/api/scm/work/issues/detail', input, forgeIssueDetailSchema))
  await Effect.runPromise(read('/api/scm/work/issues/detail', input, forgeIssueDetailSchema))
  expect(calls).toBe(2)
})
it('rejects unchanged data without a live baseline and never opts mutations in', async () => {
  const read = jiraReader({}, 'runtime', (_path, _input, schema) =>
    Effect.sync(() => decode(schema, { unchanged: true, readVersion: 'a'.repeat(64) })),
  )
  await expect(
    Effect.runPromise(read('/api/scm/work/issues/detail', input, forgeIssueDetailSchema)),
  ).rejects.toThrow('matching live baseline')
  const reply = conditionalReadSchema(forgeIssueDetailSchema)
  // Mutation schemas and request bodies pass through without caching or conditional fields.
  const bodies: unknown[] = []
  const mutate = jiraReader({}, 'runtime', (_path, body, schema) =>
    Effect.sync(() => {
      bodies.push(body)
      return decode(schema, issue)
    }),
  )
  await Effect.runPromise(mutate('/api/scm/work/issues/action', input, reply))
  await Effect.runPromise(mutate('/api/scm/work/issues/action', input, reply))
  expect(bodies).toEqual([input, input])
})
