import { Effect, Deferred, Fiber } from 'effect'
import { expect, it, vi } from 'vite-plus/test'
import { finalizePairing } from './pair-finalization'

it.each(['success', 'failure'] as const)(
  'finishes an approved pairing and reports %s even when polling is interrupted',
  async (outcome) => {
    const gate = Effect.runSync(Deferred.make<void>())
    const started = Effect.runSync(Deferred.make<void>())
    const complete = vi.fn<() => void>()
    const failed = vi.fn<(error: Error) => void>()
    const work = Effect.gen(function* () {
      yield* Deferred.succeed(started, undefined)
      yield* Deferred.await(gate)
      if (outcome === 'failure') return yield* Effect.fail(new Error('connection closed'))
      complete()
    })
    const fiber = Effect.runFork(finalizePairing(work, failed))
    await Effect.runPromise(Deferred.await(started))
    const stopping = Effect.runPromise(Fiber.interrupt(fiber))
    await Effect.runPromise(Deferred.succeed(gate, undefined))
    await stopping
    expect(complete).toHaveBeenCalledTimes(outcome === 'success' ? 1 : 0)
    expect(failed).toHaveBeenCalledTimes(outcome === 'failure' ? 1 : 0)
    expect(failed.mock.calls.map(([error]) => error.message)).toEqual(
      outcome === 'failure' ? ['connection closed'] : [],
    )
  },
)
