import { EventEmitter } from 'node:events'
import { Effect, Exit, Cause } from 'effect'
import { expect, it, vi } from 'vite-plus/test'
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

it.each([
  ['SIGINT', 130],
  ['SIGTERM', 143],
] as const)('forces exit on repeated %s while graceful shutdown is pending', (event, code) => {
  const target = new EventEmitter()
  const forceExit = vi.fn<(code: number) => void>()
  const shutdown = shutdownSignal(target, forceExit)
  target.emit(event)
  expect(shutdown.signal.aborted).toBe(true)
  expect(forceExit).not.toHaveBeenCalled()
  target.emit(event)
  expect(forceExit).toHaveBeenCalledExactlyOnceWith(code)
  shutdown.dispose()
  target.emit(event)
  expect(forceExit).toHaveBeenCalledTimes(1)
})

it('keeps repeated IPC disconnect graceful but lets a signal force pending shutdown', () => {
  const target = new EventEmitter()
  const forceExit = vi.fn<(code: number) => void>()
  const shutdown = shutdownSignal(target, forceExit)
  target.emit('disconnect')
  target.emit('disconnect')
  expect(forceExit).not.toHaveBeenCalled()
  target.emit('SIGTERM')
  expect(forceExit).toHaveBeenCalledExactlyOnceWith(143)
  shutdown.dispose()
})
