import { Data, Effect } from 'effect'

export class ExtensionError extends Data.TaggedError('ExtensionError')<{
  readonly operation: string
  readonly cause: unknown
}> {
  get message() {
    return this.cause instanceof Error ? this.cause.message : String(this.cause)
  }
}
export type ExtensionOperation<A> = A | Promise<A> | Effect.Effect<A, unknown>

/** Extensions may cross a third-party Promise boundary; the host composes Effects. */
export function extensionOperation<A>(
  operation: string,
  run: () => ExtensionOperation<A>,
): Effect.Effect<A, ExtensionError> {
  const failure = (cause: unknown) => new ExtensionError({ operation, cause })
  return Effect.try({ try: run, catch: failure }).pipe(
    Effect.flatMap((value) => {
      if (Effect.isEffect(value)) return Effect.mapError(value, failure)
      return Effect.tryPromise({ try: () => Promise.resolve(value), catch: failure })
    }),
  )
}
