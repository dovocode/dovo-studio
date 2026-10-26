import { decode, mutableStruct } from '@dovo/protocol'
import { Schema } from 'effect'

export const projectSelectionSchema = mutableStruct({
  status: Schema.Literals(['selected', 'ambiguous']),
  repositoryId: Schema.NullOr(Schema.String),
  links: Schema.Array(
    mutableStruct({
      repositoryId: Schema.String,
      access: Schema.Literals(['read-only', 'edit']),
    }),
  ).pipe(Schema.check(Schema.isMaxLength(12))),
  reason: Schema.String.pipe(Schema.check(Schema.isMaxLength(1000))),
})

/** Accept presentation around one JSON object, never repair JSON or infer project IDs. */
export function parseProjectSelection(output: string) {
  let value: unknown
  try {
    value = JSON.parse(output.trim())
  } catch {
    const start = output.indexOf('{')
    const end = output.lastIndexOf('}')
    if (start < 0 || end < start) throw new Error('Missing project selection JSON')
    value = JSON.parse(output.slice(start, end + 1))
  }
  return decode(projectSelectionSchema, value)
}
