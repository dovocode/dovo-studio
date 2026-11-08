import { Schema } from 'effect'
import { mutableArray, mutableStruct, minValue, maxValue } from '../shared/schema.js'

export const commitShaSchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)),
)
export const localCommitTargetSchema = mutableStruct({
  id: maxValue(minValue(Schema.String, 1), 200),
  checkoutId: Schema.optional(maxValue(minValue(Schema.String, 1), 200)),
})
export const localCommitSchema = mutableStruct({
  sha: commitShaSchema,
  subject: Schema.String,
  author: Schema.String,
  date: Schema.String,
  parents: mutableArray(commitShaSchema),
})
export const localCommitsSchema = mutableStruct({
  commits: mutableArray(localCommitSchema),
  hasMore: Schema.Boolean,
})
export type LocalCommit = typeof localCommitSchema.Type
