import { ValidationError, safeValidationMessage } from '@dovo/protocol'
export function resourceError(error: unknown): string {
  if (error instanceof ValidationError) return safeValidationMessage(error)
  return error instanceof Error ? error.message : String(error)
}
