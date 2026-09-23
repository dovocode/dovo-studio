import { Cause, Effect, Fiber } from 'effect'

/** Framework-owned commands are cancelled together when their view is released. */
export function clientTaskScope() {
  const pending = new Set<Fiber.RuntimeFiber<void, never>>()
  let closed = false
  return {
    run(work: Effect.Effect<void>): Promise<void> {
      if (closed) return Promise.resolve()
      const fiber = Effect.runFork(
        work.pipe(
          Effect.tapErrorCause((cause) =>
            Cause.isInterruptedOnly(cause) ? Effect.void : Effect.logError(cause),
          ),
        ),
      )
      pending.add(fiber)
      return Effect.runPromise(Fiber.await(fiber)).then(() => {
        pending.delete(fiber)
      })
    },
    stop(): Promise<void> {
      closed = true
      return Effect.runPromise(
        Effect.forEach(pending, Fiber.interrupt, { concurrency: 'unbounded', discard: true }),
      )
    },
  }
}
