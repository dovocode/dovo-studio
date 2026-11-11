import { createHash } from 'node:crypto'
import { decode, readVersionSchema } from '@dovo/protocol'
import { Schema } from 'effect'

/** Compare only after ordinary account/destination guards and cache reads complete. */
export function conditionalRead<T, I>(
  input: Record<string, unknown>,
  result: unknown,
  schema: Schema.Codec<T, I>,
) {
  if (input.conditional !== true) return result
  // Apply defaults consistently on both the first load and the persisted cache read.
  const value = decode(schema, result)
  const known = decode(Schema.UndefinedOr(readVersionSchema), input.knownVersion)
  const canonical = JSON.stringify(value, (key, field: unknown) =>
    key === 'stale' && field === false
      ? undefined
      : field && typeof field === 'object' && !Array.isArray(field)
        ? Object.fromEntries(Object.entries(field).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
        : field,
  )
  const readVersion = createHash('sha256').update(canonical).digest('hex')
  return known === readVersion ? { unchanged: true as const, readVersion } : { value, readVersion }
}
