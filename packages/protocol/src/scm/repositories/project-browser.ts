import { Schema } from 'effect'
import { mutableArray, mutableStruct } from '../../shared/schema.js'

export const projectDirectorySchema = mutableStruct({
  entries: mutableArray(
    mutableStruct({ path: Schema.String, kind: Schema.Literals(['file', 'directory']) }),
  ),
  nextCursor: Schema.optional(Schema.String),
  truncated: Schema.Boolean,
})
export const projectContentMatchSchema = mutableStruct({
  path: Schema.String,
  line: Schema.Number,
  excerpt: Schema.String,
  matchStart: Schema.Number,
  matchEnd: Schema.Number,
})
export const projectContentSearchSchema = mutableStruct({
  matches: mutableArray(projectContentMatchSchema),
  truncated: Schema.Boolean,
  scannedFiles: Schema.Number,
  skippedFiles: Schema.Number,
})
export type ProjectDirectory = typeof projectDirectorySchema.Type
export type ProjectContentMatch = typeof projectContentMatchSchema.Type
export type ProjectContentSearch = typeof projectContentSearchSchema.Type
