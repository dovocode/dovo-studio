import { Effect } from 'effect'

/** Recover a failed local read without replacing edits received while it was pending. */
export function hydrateDraft<E>(
  read: Effect.Effect<string | null, E>,
  current: { initial: () => string; edited: () => boolean },
) {
  return read.pipe(
    Effect.match({
      onSuccess: (value) => ({ value, error: '' }),
      onFailure: (error) => ({ value: null, error: String(error) }),
    }),
    Effect.map(({ value, error }) => ({
      text: current.edited() ? undefined : (value ?? current.initial()),
      error,
    })),
  )
}
