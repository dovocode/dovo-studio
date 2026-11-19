import { Schema } from 'effect'
import { maxValue, mutableArray, mutableStruct, strictStruct } from '../../shared/schema.js'

export const linearIssueQuerySchema = strictStruct({
  cursor: Schema.optional(maxValue(Schema.String, 1000)),
  search: Schema.optional(maxValue(Schema.String, 200)),
})

const linearIssueSchema = mutableStruct({
  id: Schema.String,
  identifier: Schema.String,
  title: Schema.String,
  url: Schema.String,
  description: Schema.String,
  status: Schema.String,
})

export const linearIssuesSchema = mutableStruct({
  items: mutableArray(linearIssueSchema),
  next: Schema.optional(Schema.String),
})
export type LinearIssue = typeof linearIssueSchema.Type

export const linearKeySourceSchema = Schema.Literals(['none', 'saved', 'environment'])
export const linearKeyResultSchema = mutableStruct({ source: linearKeySourceSchema })
