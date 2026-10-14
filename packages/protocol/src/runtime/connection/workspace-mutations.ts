import { decodeResult } from '../../shared/schema.js'
import { RuntimeRequestError } from '../../shared/client.js'
import { workspacePatchResultSchema } from './runtime.js'

/** A domain rejection is a settled edit, not a reason to stop replication. */
export function workspacePatchRejected(error: unknown): error is RuntimeRequestError {
  return (
    error instanceof RuntimeRequestError &&
    (error.status === 400 ||
      (error.mutationRejected === true && [403, 404, 409, 422].includes(error.status ?? 0)))
  )
}
export function workspacePatchRejection(value: unknown) {
  const result = decodeResult(workspacePatchResultSchema, value)
  if (!result.success || result.data.outcome !== 'rejected') return undefined
  return new RuntimeRequestError({
    kind: 'response',
    status: 400,
    mutationRejected: true,
    message: result.data.reason ?? 'This edit no longer applies. It was saved in Recovered edits.',
  })
}

/** The edit must stay queued until its recovery record can be saved. */
export class WorkspaceStorageError extends Error {
  override readonly name = 'WorkspaceStorageError'
}
