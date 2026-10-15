import { expect, it, vi } from 'vite-plus/test'
import { Effect, Schema } from 'effect'
import { decode, RuntimeRequestError } from '@dovo/protocol'
import type { Runtime } from '../runtime/connection/provider'
import { discoverReader, verifiedSourceRead } from './source-reader'

vi.mock('../runtime/connection/provider', () => ({ useRuntime: vi.fn<() => void>() }))
const response = Schema.Struct({ title: Schema.String })

it('rejects a same-account rebind before fresh discovery can authorize unrelated content', async () => {
  let destination = 'repo-X'
  const reads: string[] = []
  const read: Runtime['readEffect'] = (path, _input, schema) => {
    reads.push(path)
    return Effect.sync(() =>
      decode(
        schema,
        path.endsWith('/identity') ? { readerIdentity: 'account', destination } : { title: 'X PR' },
      ),
    )
  }
  const guarded = verifiedSourceRead(
    read,
    'before-discovery-rebind',
    { repositoryId: 'replica' },
    'account',
  )
  await Effect.runPromise(guarded('/api/scm/pulls/detail', { number: 7 }, response))
  destination = 'repo-Y'
  await expect(
    Effect.runPromise(guarded('/api/scm/pulls/detail', { number: 7 }, response)),
  ).rejects.toThrow(/repository changed/)
  expect(reads).toEqual([
    '/api/scm/source/identity',
    '/api/scm/pulls/detail',
    '/api/scm/source/identity',
  ])
})

it('discovers the account and passes its verified identity on actual read dispatch', async () => {
  const inputs: unknown[] = []
  let account = 'account-one'
  const read: Runtime['readEffect'] = (path, input, schema) => {
    inputs.push(input)
    return Effect.sync(() =>
      decode(
        schema,
        path === '/api/scm/source/identity'
          ? { readerIdentity: account, destination: 'repository-binding' }
          : { title: 'PR #7' },
      ),
    )
  }
  const guarded = verifiedSourceRead(read, 'guarded-read-regression', { repositoryId: 'repo' })
  await Effect.runPromise(
    guarded('/api/scm/pulls/detail', { repositoryId: 'repo', number: 7 }, response),
  )
  expect(inputs[1]).toEqual({
    repositoryId: 'repo',
    number: 7,
    expectedReaderIdentity: 'account-one',
    expectedDestination: 'repository-binding',
  })
  account = 'account-two'
  await expect(
    Effect.runPromise(
      guarded('/api/scm/pulls/detail', { repositoryId: 'repo', number: 7 }, response),
    ),
  ).rejects.toThrow(/different account/)
  expect(inputs).toHaveLength(3)
})

it('permits legacy reads without claiming an identity but never swallows missing sources or auth failures', async () => {
  const failure =
    (status: number, message: string): Runtime['readEffect'] =>
    () =>
      Effect.fail(new RuntimeRequestError({ kind: 'response', status, message }))
  expect(
    await Effect.runPromise(
      discoverReader(failure(404, 'Endpoint not found'), 'legacy-discovery', {
        repositoryId: 'repo',
      }),
    ),
  ).toBeUndefined()
  await expect(
    Effect.runPromise(
      discoverReader(failure(404, 'Repository not found'), 'missing-discovery', {
        repositoryId: 'repo',
      }),
    ),
  ).rejects.toThrow(/Repository not found/)
  await expect(
    Effect.runPromise(
      discoverReader(failure(401, 'Pairing required'), 'unauthorized-discovery', {
        repositoryId: 'repo',
      }),
    ),
  ).rejects.toThrow(/Pairing required/)
})

it('rejects a freshly discovered alternate account or legacy reader before the detail read', async () => {
  for (const candidate of ['different-account', 'legacy']) {
    const calls: string[] = []
    const read: Runtime['readEffect'] = (path, _input, schema) => {
      calls.push(path)
      return candidate === 'legacy'
        ? Effect.fail(
            new RuntimeRequestError({
              kind: 'response',
              status: 501,
              message: 'Endpoint not found',
            }),
          )
        : Effect.sync(() =>
            decode(schema, { readerIdentity: candidate, destination: 'alternate-binding' }),
          )
    }
    await expect(
      Effect.runPromise(
        verifiedSourceRead(
          read,
          `fresh-alternate-${candidate}`,
          { repositoryId: 'replica' },
          'original-account',
        )('/api/scm/pulls/detail', { repositoryId: 'replica', number: 7 }, response),
      ),
    ).rejects.toThrow(/original account is unavailable/)
    expect(calls).toEqual(['/api/scm/source/identity'])
  }
})

for (const change of ['destination', 'readerIdentity'] as const) {
  it(`rejects a ${change} race between discovery and dispatch, including pagination`, async () => {
    const guardSchema = Schema.Struct({
      expectedDestination: Schema.optional(Schema.String),
      expectedReaderIdentity: Schema.optional(Schema.String),
    })
    const current = { readerIdentity: 'account', destination: 'replica-X' }
    let race = false
    let providerReads = 0
    const read: Runtime['readEffect'] = (path, input, schema) =>
      Effect.try({
        try: () => {
          if (path.endsWith('/identity')) {
            const discovered = decode(schema, current)
            if (race) current[change] = 'changed'
            return discovered
          }
          const guard = decode(guardSchema, input)
          if (
            (guard.expectedDestination !== undefined &&
              guard.expectedDestination !== current.destination) ||
            (guard.expectedReaderIdentity !== undefined &&
              guard.expectedReaderIdentity !== current.readerIdentity)
          )
            throw new RuntimeRequestError({
              kind: 'response',
              status: 409,
              message: 'Source changed during dispatch',
            })
          providerReads++
          return decode(schema, { title: 'PR #7' })
        },
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      })
    const guarded = verifiedSourceRead(read, `dispatch-race-${change}`, { repositoryId: 'replica' })
    await Effect.runPromise(guarded('/api/scm/pulls/overview', { page: 1 }, response))
    race = true
    await expect(
      Effect.runPromise(guarded('/api/scm/pulls/overview', { page: 2 }, response)),
    ).rejects.toThrow(/changed/)
    expect(providerReads).toBe(1)
  })
}
