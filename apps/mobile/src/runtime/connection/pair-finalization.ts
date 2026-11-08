import { Effect } from 'effect'

/** Once approval is claimed, finish or report failure even if the polling worker is stopped.
 * An uncertain mutation must never be retried automatically. */
export function finalizePairing(
  work: Effect.Effect<void, Error>,
  onFailure: (error: Error) => void,
) {
  return work.pipe(
    Effect.catch((error) => Effect.sync(() => onFailure(error))),
    Effect.uninterruptible,
  )
}
