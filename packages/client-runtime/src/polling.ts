import { Cause, Effect, Fiber, Queue } from 'effect'

type PollingOptions<E> = {
  interval: number
  onError: (error: E) => void
  immediate?: boolean
  /** Stretch the wait after consecutive failures, up to this many milliseconds. */
  backoff?: number
}

/** One owned worker; timer and foreground wakeups coalesce instead of overlapping. */
export function startPolling<E>(work: Effect.Effect<void, E>, options: PollingOptions<E>) {
  const wakeups = Effect.runSync(Queue.dropping<void>(1))
  let stopped = false
  let failures = 0
  const refresh = () => {
    if (!stopped) Effect.runSync(Queue.offer(wakeups, undefined))
  }
  // The interval runs from completion, so a slow read is never followed by an immediate one.
  const delay = () => {
    if (!failures || !options.backoff || options.backoff <= options.interval)
      return options.interval
    const grown = Math.min(options.interval * 2 ** Math.min(failures, 16), options.backoff)
    // Jitter keeps several clients of one recovering host from retrying in lockstep.
    return Math.round(grown * (0.8 + Math.random() * 0.2))
  }
  const cycle = work.pipe(
    Effect.tap(() =>
      Effect.sync(() => {
        failures = 0
      }),
    ),
    Effect.catchAll((error) =>
      Effect.sync(() => {
        failures++
        options.onError(error)
      }).pipe(
        // A faulty reporting callback must not take down the owned polling worker.
        Effect.catchAllCause(Effect.logError),
      ),
    ),
    Effect.zipRight(
      Effect.suspend(() =>
        Effect.raceFirst(Queue.take(wakeups), Effect.sleep(delay())).pipe(Effect.asVoid),
      ),
    ),
  )
  const fiber = Effect.runFork(
    Effect.gen(function* () {
      if (options.immediate === false)
        yield* Effect.raceFirst(Queue.take(wakeups), Effect.sleep(options.interval))
      yield* Effect.forever(cycle)
    }).pipe(
      Effect.tapErrorCause((cause) =>
        Cause.isInterruptedOnly(cause) ? Effect.void : Effect.logError(cause),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          stopped = true
        }).pipe(Effect.zipRight(Queue.shutdown(wakeups))),
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
