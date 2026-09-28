import { Effect, type Utils } from 'effect'

type NativeResult<A> = Awaited<A> extends { readonly [Effect.EffectTypeId]: unknown } ? never : A

/** Adapt SDK operations or synchronous UI callbacks, never an already composed Effect. */
export const nativeEffect = <A>(run: (signal: AbortSignal) => A & NativeResult<A>) =>
  Effect.tryPromise({
    try: (signal) => Promise.resolve(run(signal)),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  })

/** SDKs may throw synchronously as well as reject. Keep both in the UI error channel. */
export const mobileWorkflow = <A, E>(
  body: () => Generator<Utils.YieldWrap<Effect.Effect<unknown, E>>, A, never>,
): Effect.Effect<A, E | Error> =>
  Effect.gen(body).pipe(
    Effect.catchAllDefect((cause) =>
      Effect.fail(cause instanceof Error ? cause : new Error(String(cause))),
    ),
  )
