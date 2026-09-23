import { Cause, Effect, Fiber, Queue } from 'effect'

/** One owned worker; timer and foreground wakeups coalesce instead of overlapping. */
export function startPolling<E>(
  work: Effect.Effect<void, E>,
  options: { interval: number; onError: (error: E) => void; immediate?: boolean },
) {
  const wakeups = Effect.runSync(Queue.dropping<void>(1))
  let stopped = false
  const refresh = () => {
    if (!stopped) Effect.runSync(Queue.offer(wakeups, undefined))
  }
  const fiber = Effect.runFork(
    Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() => Queue.shutdown(wakeups))
        yield* Effect.forkScoped(
          Effect.forever(
            Effect.sleep(options.interval).pipe(Effect.zipRight(Queue.offer(wakeups, undefined))),
          ),
        )
        if (options.immediate !== false) yield* Queue.offer(wakeups, undefined)
        yield* Effect.forever(
          Queue.take(wakeups).pipe(
            Effect.zipRight(work),
            Effect.catchAll((error) => Effect.sync(() => options.onError(error))),
          ),
        )
      }).pipe(
        Effect.tapErrorCause((cause) =>
          Cause.isInterruptedOnly(cause) ? Effect.void : Effect.logError(cause),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            stopped = true
          }),
        ),
      ),
    ),
  )
  return {
    refresh,
    stop: () => {
      stopped = true
      return Effect.runPromise(Fiber.interrupt(fiber)).then(() => undefined)
    },
  }
}
