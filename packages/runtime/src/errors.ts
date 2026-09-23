import { Data, Effect } from 'effect'
import { ValidationError } from '@dovo/protocol'

export class HttpError extends Data.TaggedError('HttpError')<{
  readonly status: number
  readonly message: string
}> {
  constructor(status: number, message: string) {
    super({ status, message })
  }
}
export class RuntimeOperationError extends Data.TaggedError('RuntimeOperationError')<{
  readonly cause: unknown
}> {
  get message() {
    return errorMessage(this.cause)
  }
}
export type RuntimeFailure = HttpError | ValidationError | RuntimeOperationError
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
export const runtimeFailure = (cause: unknown): RuntimeFailure =>
  cause instanceof HttpError ||
  cause instanceof ValidationError ||
  cause instanceof RuntimeOperationError
    ? cause
    : new RuntimeOperationError({ cause })

/** Explicit boundary around filesystem, native APIs and third-party SDK operations. */
export const runtimeOperation = <A>(run: () => A): Effect.Effect<Awaited<A>, RuntimeFailure> =>
  Effect.try({ try: run, catch: runtimeFailure }).pipe(
    Effect.flatMap((value) =>
      Effect.tryPromise({ try: () => Promise.resolve(value), catch: runtimeFailure }),
    ),
  )

/** Keep known synchronous domain failures typed while preserving unexpected defects. */
export const runtimeProgram = <A, E, R>(program: Effect.Effect<A, E, R>) =>
  program.pipe(
    Effect.catchAllDefect((cause) =>
      cause instanceof HttpError || cause instanceof ValidationError
        ? Effect.fail(cause)
        : Effect.die(cause),
    ),
  )
