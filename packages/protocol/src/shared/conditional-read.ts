import { Schema } from 'effect'
import { mutableStruct } from './schema.js'

export const readVersionSchema = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))

export const conditionalReadFields = {
  conditional: Schema.optional(Schema.Boolean),
  knownVersion: Schema.optional(readVersionSchema),
}

/** Legacy servers return the value directly; opt-in servers can return a matching live version. */
export function conditionalReadSchema<T, I>(schema: Schema.Codec<T, I>) {
  return Schema.Union([
    mutableStruct({ unchanged: Schema.Literal(true), readVersion: readVersionSchema }),
    mutableStruct({ value: schema, readVersion: readVersionSchema }),
    schema,
  ])
}
