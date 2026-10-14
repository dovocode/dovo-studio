import { expect, it, vi } from 'vite-plus/test'
import { Effect, Schema } from 'effect'
import { decode, RuntimeRequestError } from '@dovo/protocol'
import type { Runtime } from '../runtime/connection/provider'
import { discoverReader, verifiedSourceRead } from './source-reader'

vi.mock('../runtime/connection/provider', () => ({ useRuntime: vi.fn<() => void>() }))
const response = Schema.Struct({ title: Schema.String })

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
