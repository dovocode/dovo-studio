import { RuntimeRequestError } from '@dovo/protocol'

export function integrationMutationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return error instanceof RuntimeRequestError && error.status === 409
    ? `${message} Your draft is preserved. Refresh the source and review the destination before submitting again.`
    : message
}
