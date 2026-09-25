import { Effect, Fiber } from 'effect'

/** Owns one connection attempt/session, including its abort cleanup and bounded backoff. */
export function startReconnecting(
  connect: (signal: AbortSignal, connected: () => void) => Promise<void>,
  onError: (error: Error) => void,
) {
  let stopped = false
  let delay = 1000
  const work = Effect.forever(
    Effect.tryPromise({
      try: (signal) =>
        connect(signal, () => {
          delay = 1000
        }),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }).pipe(
      Effect.catchAll((error) =>
        // A faulty reporting callback must not end reconnection for the session's lifetime.
        Effect.sync(() => onError(error)).pipe(Effect.catchAllCause(Effect.logError)),
      ),
      Effect.zipRight(
        Effect.suspend(() => {
          // Jitter keeps clients of a restarted host from reconnecting in lockstep.
          const wait = Math.round(delay * (1 + Math.random() * 0.2))
          delay = Math.min(delay * 2, 30000)
          return Effect.sleep(wait)
        }),
      ),
    ),
  )
  let fiber = Effect.runFork(work)
  return {
    restart() {
      if (stopped) return
      delay = 1000
      fiber = Effect.runFork(Fiber.interrupt(fiber).pipe(Effect.zipRight(work)))
    },
    stop() {
      stopped = true
      return Effect.runPromise(Fiber.interrupt(fiber)).then(() => undefined)
    },
  }
}
