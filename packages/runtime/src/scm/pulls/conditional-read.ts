import { createHash } from 'node:crypto'
import { decode, pullReadVersionSchema, type PullDetail, type PullPage } from '@dovo/protocol'
import { Schema } from 'effect'

/** Run account/destination validation and the normal cache read before comparing versions. */
export function conditionalPullRead<T extends PullDetail | PullPage>(
  input: Record<string, unknown>,
  value: T,
) {
  if (input.conditional !== true) return value
  const known = decode(Schema.UndefinedOr(pullReadVersionSchema), input.knownVersion)
  const canonical = JSON.stringify(value, (_key, field: unknown) =>
    field && typeof field === 'object' && !Array.isArray(field)
      ? Object.fromEntries(Object.entries(field).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : field,
  )
  const readVersion = createHash('sha256').update(canonical).digest('hex')
  return known === readVersion
    ? { unchanged: true as const, readVersion }
    : { ...value, readVersion }
}
