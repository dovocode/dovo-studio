import { Effect, Either } from 'effect'

/** Preserve typed errors at a framework or native Promise boundary. */
export async function runClientEffect<A, E>(
  effect: Effect.Effect<A, E>,
  signal?: AbortSignal,
): Promise<A> {
  const result = await Effect.runPromise(Effect.either(effect), { signal })
  if (Either.isLeft(result)) throw result.left
  return result.right
}
