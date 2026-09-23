import { uuidSchema } from './schema.js'
import { mutableStruct } from './schema.js'
import { minValue, maxValue } from './schema.js'
import { Schema } from 'effect'
import { forgeIssueSchema, forgePipelineSchema } from './forge-work.js'
import { forgeProviderSchema } from './forges.js'
const source = {
  id: forgeIssueSchema.fields.id,
  url: forgeIssueSchema.fields.url,
  title: Schema.String,
}
export const taskWorkItemSchema = Schema.Union(
  ...[
    mutableStruct({
      ...source,
      kind: Schema.Literal('issue'),
      jiraSourceId: Schema.optional(maxValue(minValue(Schema.String, 1), 200)),
      provider: Schema.Union(forgeProviderSchema, Schema.Literal('jira')),
      revision: forgeIssueSchema.fields.revision,
    }),
    mutableStruct({
      ...source,
      kind: Schema.Literal('pipeline'),
      provider: forgeProviderSchema,
      ref: forgePipelineSchema.fields.ref,
      sha: forgePipelineSchema.fields.sha,
    }),
  ],
)
const input = {
  repositoryId: maxValue(minValue(Schema.String, 1), 200),
  id: source.id,
  url: source.url,
  requestId: uuidSchema,
}
export const workTaskInputSchema = Schema.Union(
  ...[
    mutableStruct({
      ...input,
      kind: Schema.Literal('issue'),
      jiraSourceId: Schema.optional(maxValue(minValue(Schema.String, 1), 200)),
      revision: maxValue(minValue(Schema.String, 1), 300),
    }),
    mutableStruct({
      ...input,
      kind: Schema.Literal('pipeline'),
      sha: maxValue(Schema.String, 300),
    }),
  ],
)
export const workTaskResponseSchema = mutableStruct({
  id: uuidSchema,
})
export type TaskWorkItem = Schema.Schema.Type<typeof taskWorkItemSchema>
export type WorkTaskInput = Schema.Schema.Type<typeof workTaskInputSchema>
