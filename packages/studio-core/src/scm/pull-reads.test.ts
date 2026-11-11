import type { pullPageReadSchema } from '@dovo/protocol'
import { Effect } from 'effect'
import { expect, it, vi } from 'vite-plus/test'
import { readPullPage } from './pull-reads'

it('shares a PR read only within its owning runtime cache and captured binding', async () => {
  const request = vi.fn<() => Effect.Effect<typeof pullPageReadSchema.Type>>(() =>
    Effect.succeed({ pulls: [], page: 1, hasMore: false, readVersion: 'a'.repeat(64) }),
  )
  const owner = {}
  const a = await Effect.runPromise(readPullPage(owner, 'account/project', request))
  const b = await Effect.runPromise(readPullPage(owner, 'account/project', request))
  expect(a).toBe(b)
  expect(request).toHaveBeenCalledTimes(1)
  await Effect.runPromise(readPullPage({}, 'account/project', request))
  await Effect.runPromise(readPullPage(owner, 'new-account/project', request))
  expect(request).toHaveBeenCalledTimes(3)
})
it('retains the actual transport error instead of replacing it with a cached private response', async () => {
  const owner = {}
  await Effect.runPromise(
    readPullPage(owner, 'pr', () => Effect.succeed({ pulls: [], page: 1, hasMore: false })),
  )
  const rejected = new Error('Account was revoked')
  const error = await Effect.runPromise(
    Effect.result(readPullPage(owner, 'pr', () => Effect.fail(rejected), true)),
  )
  expect(error).toMatchObject({ _tag: 'Failure', failure: rejected })
})
