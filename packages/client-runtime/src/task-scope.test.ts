import { Deferred, Effect } from 'effect'
import { expect, it } from 'vitest'
import { clientTaskScope } from './task-scope.js'

it('cancels every view command, waits for cleanup, and rejects new work after release', async () => {
  const scope = clientTaskScope()
  const started = Effect.runSync(Deferred.make<void>())
  const released = Effect.runSync(Deferred.make<void>())
  let active = 0
  const pending = scope.run(
    Effect.acquireUseRelease(
      Effect.sync(() => {
        active++
      }),
      () => Deferred.succeed(started, undefined).pipe(Effect.zipRight(Effect.never)),
      () =>
        Deferred.await(released).pipe(
          Effect.zipRight(
            Effect.sync(() => {
              active--
            }),
          ),
        ),
    ),
  )
  await Effect.runPromise(Deferred.await(started))
  let stopped = false
  const stopping = scope.stop().then(() => {
    stopped = true
  })
  await scope.run(
    Effect.sync(() => {
      active++
    }),
  )
  expect(active).toBe(1)
  expect(stopped).toBe(false)
  Effect.runSync(Deferred.succeed(released, undefined))
  await Promise.all([pending, stopping])
  expect(active).toBe(0)
  expect(stopped).toBe(true)
  await scope.stop()
})
