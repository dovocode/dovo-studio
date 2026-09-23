import { Effect } from 'effect'
import { runtimeFailure, runtimeProgram, type RuntimeFailure } from '../errors.js'

/** Adapter boundary for native SDKs and synchronous platform services. */
export const serviceResult = <A>(value: A): Effect.Effect<Awaited<A>, RuntimeFailure> =>
  Effect.tryPromise({ try: () => Promise.resolve(value), catch: runtimeFailure })

export const routeProgram = runtimeProgram
