import { Effect, Fiber } from 'effect'
import { expect, it } from 'vite-plus/test'
import { runClientEffect } from '@dovo/client-runtime'
import { mobileWorkflow, nativeEffect } from './native-effect'

it('recovers synchronous SDK failures and always releases UI busy state', async () => {
  let busy = false
  const failure = new Error('Native permission service unavailable')
  let reported: unknown
  const operation = mobileWorkflow(function* () {
    busy = true
    yield* nativeEffect(() => {
      throw failure
    })
  }).pipe(
    Effect.catchAll((cause) =>
      Effect.sync(() => {
        reported = cause
      }),
    ),
    Effect.ensuring(
      Effect.sync(() => {
        busy = false
      }),
    ),
  )
  await runClientEffect(operation)
  expect(reported).toBe(failure)
  expect(busy).toBe(false)
})

it('interrupts abort-aware native work without executing its successful continuation', async () => {
  let aborted = false,
    published = false
  const program = nativeEffect(
    (signal) =>
      new Promise<void>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            aborted = true
            reject(new Error('aborted'))
          },
          { once: true },
        )
      }),
  ).pipe(
    Effect.tap(() =>
      Effect.sync(() => {
        published = true
      }),
    ),
  )
  const fiber = Effect.runFork(program)
  await new Promise((resolve) => setTimeout(resolve, 0))
  await Effect.runPromise(Fiber.interrupt(fiber))
  expect(aborted).toBe(true)
  expect(published).toBe(false)
})
