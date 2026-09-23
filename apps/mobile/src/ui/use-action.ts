import {
  ValidationError,
  safeValidationMessage,
  safeValidationIssues,
  RuntimeRequestError,
} from '@dovo/protocol'
import { Effect } from 'effect'
import { runClientEffect } from '@dovo/client-runtime'
import { useApplicationState } from '../runtime/application-state'

export function useAction() {
  const [permit] = useApplicationState(() => Effect.runSync(Effect.makeSemaphore(1)))
  const [state, setState] = useApplicationState<{
    busy: boolean
    error: string
    issues: readonly { path: string; message: string }[]
  }>({ busy: false, error: '', issues: [] })
  const run = (work: () => Promise<unknown> | Effect.Effect<unknown, unknown>) =>
    runClientEffect(
      permit
        .withPermitsIfAvailable(1)(
          Effect.gen(function* () {
            setState({ busy: true, error: '', issues: [] })
            const operation = yield* Effect.try({ try: work, catch: (error) => error })
            yield* Effect.isEffect(operation)
              ? operation
              : Effect.tryPromise({ try: () => operation, catch: (error) => error })
          }).pipe(
            Effect.catchAll((error) =>
              Effect.sync(() =>
                setState((current) => ({
                  ...current,
                  issues:
                    error instanceof ValidationError
                      ? safeValidationIssues(error)
                      : error instanceof RuntimeRequestError
                        ? (error.issues ?? [])
                        : [],
                  error:
                    error instanceof ValidationError
                      ? safeValidationMessage(error)
                      : error instanceof Error
                        ? error.message
                        : String(error),
                })),
              ),
            ),
            Effect.ensuring(
              Effect.sync(() => setState((current) => ({ ...current, busy: false }))),
            ),
          ),
        )
        .pipe(Effect.asVoid),
    )
  return {
    ...state,
    fieldError: (path: string) => state.issues.find((issue) => issue.path === path)?.message,
    run,
    act: (work: () => Promise<unknown> | Effect.Effect<unknown, unknown>) => {
      void run(work)
    },
  }
}
