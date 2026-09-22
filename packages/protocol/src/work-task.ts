import { z } from 'zod'
import { forgeIssueSchema, forgePipelineSchema } from './forge-work.js'
import { forgeProviderSchema } from './forges.js'

const source = {
  id: forgeIssueSchema.shape.id,
  url: forgeIssueSchema.shape.url,
  title: z.string(),
}

export const taskWorkItemSchema = z.discriminatedUnion('kind', [
  z.object({
    ...source,
    kind: z.literal('issue'),
    jiraSourceId: z.string().min(1).max(200).optional(),
    provider: z.union([forgeProviderSchema, z.literal('jira')]),
    revision: forgeIssueSchema.shape.revision,
  }),
  z.object({
    ...source,
    kind: z.literal('pipeline'),
    provider: forgeProviderSchema,
    ref: forgePipelineSchema.shape.ref,
    sha: forgePipelineSchema.shape.sha,
  }),
])

const input = {
  repositoryId: z.string().min(1).max(200),
  id: source.id,
  url: source.url,
  requestId: z.uuid(),
}

export const workTaskInputSchema = z.discriminatedUnion('kind', [
  z.object({
    ...input,
    kind: z.literal('issue'),
    jiraSourceId: z.string().min(1).max(200).optional(),
    revision: z.string().min(1).max(300),
  }),
  z.object({
    ...input,
    kind: z.literal('pipeline'),
    sha: z.string().max(300),
  }),
])
export const workTaskResponseSchema = z.object({ id: z.uuid() })
export type TaskWorkItem = z.infer<typeof taskWorkItemSchema>
export type WorkTaskInput = z.infer<typeof workTaskInputSchema>
