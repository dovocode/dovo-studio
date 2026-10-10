import { EventEmitter } from 'node:events'
import { Effect, Exit, Cause } from 'effect'
import { expect, it } from 'vite-plus/test'
import { shutdownSignal } from './shutdown-signal.js'
it.each(['SIGTERM', 'SIGINT', 'disconnect'])(
  'unwinds owned resources on %s during initialization',
  async (event) => {
    const target = new EventEmitter()
    const shutdown = shutdownSignal(target)
    let started = () => {}
    const initializing = new Promise<void>((resolve) => {
      started = resolve
    })
    let closed = false
    const result = Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              closed = true
            }),
          )
          started()
          yield* Effect.never
        }),
      ),
      { signal: shutdown.signal },
    )
    await initializing
    target.emit(event)
    const exit = await result
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
    expect(closed).toBe(true)
    shutdown.dispose()
    expect(target.listenerCount(event)).toBe(0)
  },
)
