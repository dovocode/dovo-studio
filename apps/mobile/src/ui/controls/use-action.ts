import {
  ValidationError,
  safeValidationMessage,
  safeValidationIssues,
  RuntimeRequestError,
} from '@dovo/protocol'
import { Effect, Semaphore } from 'effect'
import { runClientEffect } from '@dovo/client-runtime'
import { useScopedError } from '@dovo/studio-core/scoped-error'
import { useApplicationState } from '../../runtime/state/application-state'

export function useAction(errorScope?: string) {
  const [permit] = useApplicationState(() => Effect.runSync(Semaphore.make(1)))
  const [error, setError] = useScopedError(errorScope)
  const [state, setState] = useApplicationState<{
    busy: boolean
    issues: readonly { path: string; message: string }[]
    validationAttempt: number
  }>({ busy: false, issues: [], validationAttempt: 0 })
  const run = (work: () => Promise<unknown> | Effect.Effect<unknown, unknown>) =>
    runClientEffect(
      permit
        .withPermitsIfAvailable(1)(
          Effect.gen(function* () {
            setState((current) => ({ ...current, busy: true, issues: [] }))
            setError('')
            const operation = yield* Effect.try({ try: work, catch: (error) => error })
            yield* Effect.isEffect(operation)
              ? operation
              : Effect.tryPromise({ try: () => operation, catch: (error) => error })
          }).pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                const issues =
                  error instanceof ValidationError
                    ? safeValidationIssues(error)
                    : error instanceof RuntimeRequestError
                      ? (error.issues ?? [])
                      : []
                setState((current) => ({
                  ...current,
                  issues,
                  validationAttempt: current.validationAttempt + (issues.length ? 1 : 0),
                }))
                setError(
                  error instanceof ValidationError
                    ? safeValidationMessage(error)
                    : error instanceof Error
                      ? error.message
                      : String(error),
                )
              }),
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
    error,
    fieldError: (path: string) => state.issues.find((issue) => issue.path === path)?.message,
    run,
    act: (work: () => Promise<unknown> | Effect.Effect<unknown, unknown>) => {
      void run(work)
    },
  }
}
