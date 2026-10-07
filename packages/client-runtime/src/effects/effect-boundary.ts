import { Effect, Result } from 'effect'

/** Preserve typed errors at a framework or native Promise boundary. */
export async function runClientEffect<A, E>(
  effect: Effect.Effect<A, E>,
  signal?: AbortSignal,
): Promise<A> {
  const result = await Effect.runPromise(Effect.result(effect), { signal })
  if (Result.isFailure(result)) throw result.failure
  return result.success
}
