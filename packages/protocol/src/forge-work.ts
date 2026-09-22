import { z } from 'zod'
import { forgeProviderSchema } from './forges.js'

const id = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine((value) => !/[\p{Cc}]/u.test(value) && !['.', '..'].includes(value))
const url = z.url({ protocol: /^https?$/ }).refine((value) => {
  try {
    const parsed = new URL(value)
    return !parsed.username && !parsed.password
  } catch {
    return false
  }
})
const cached = {
  cachedAt: z.string().optional(),
  stale: z.boolean().optional(),
  refreshError: z.string().optional(),
}
export const forgeWorkQuerySchema = z.object({
  cursor: z.string().max(4000).optional(),
  query: z.string().trim().max(300).optional(),
  state: z.string().max(100).default('open'),
  refresh: z.boolean().default(false),
})
export const forgeWorkOptionsSchema = z.object({
  provider: z.union([forgeProviderSchema, z.literal('jira')]),
  issues: z.boolean(),
  issueNotice: z.string().optional(),
  issueTypes: z.array(z.string()).default([]),
  issueStates: z.array(z.string()).default([]),
  issueSearch: z.boolean().optional(),
  assignees: z.boolean().default(true),
  labels: z.boolean().default(false),
  pipelines: z.boolean(),
  pipelineNotice: z.string().optional(),
  pipelineActions: z.array(z.enum(['run', 'rerun', 'cancel', 'enable', 'disable'])),
})
export type ForgeWorkOptions = z.infer<typeof forgeWorkOptionsSchema>
export const forgeIssueSchema = z.object({
  id,
  title: z.string(),
  body: z.string(),
  state: z.string(),
  type: z.string().default('Issue'),
  url,
  author: z.string(),
  assignees: z.array(z.string()),
  assigneeNames: z.array(z.string()).optional(),
  labels: z.array(z.string()),
  updatedAt: z.string(),
  revision: z.string(),
  bodyFormat: z.enum(['markdown', 'html']).default('markdown'),
  preview: z.string().optional(),
  bodyNotice: z.string().optional(),
})
export type ForgeIssue = z.infer<typeof forgeIssueSchema>
export const forgeIssuePageSchema = z.object({
  items: z.array(forgeIssueSchema),
  next: z.string().optional(),
  ...cached,
})
export const forgeIssueDetailSchema = z.object({
  issue: forgeIssueSchema,
  discussionNotice: z.string().optional(),
  comments: z.array(
    z.object({
      id,
      body: z.string(),
      author: z.string(),
      createdAt: z.string(),
      url: url.optional(),
      bodyFormat: z.enum(['markdown', 'html']).default('markdown'),
    }),
  ),
  next: z.string().optional(),
  ...cached,
})
export type ForgeIssueDetail = z.infer<typeof forgeIssueDetailSchema>
const fields = {
  title: z.string().trim().min(1).max(1000),
  body: z.string().max(100000),
  assignees: z.array(z.string().trim().min(1).max(300)).max(20),
  labels: z.array(z.string().trim().min(1).max(100)).max(100),
}
export const forgeIssueCreateSchema = z.object({
  ...fields,
  assignees: fields.assignees.default([]),
  labels: fields.labels.default([]),
  type: z.string().trim().max(100).default('Issue'),
})
export type ForgeIssueCreate = z.infer<typeof forgeIssueCreateSchema>
export const forgeIssueActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('edit'),
    id,
    revision: id,
    title: fields.title.optional(),
    body: fields.body.optional(),
    state: z.string().trim().min(1).max(100).optional(),
    assignees: fields.assignees.optional(),
    labels: fields.labels.optional(),
  }),
  z.object({
    action: z.literal('comment'),
    id,
    revision: id,
    body: z.string().trim().min(1).max(100000),
  }),
])
export type ForgeIssueAction = z.infer<typeof forgeIssueActionSchema>
const pipelineTiming = {
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
}
const pipelineErrors = z.array(z.string().max(2000)).max(10).optional()
export const forgePipelineSchema = z.object({
  id,
  title: z.string(),
  url,
  ref: z.string(),
  sha: z.string(),
  actor: z.string(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  definition: z.string().optional(),
  number: z.string().optional(),
  attempt: z.number().int().positive().optional(),
  event: z.string().optional(),
  workflow: z.string().optional(),
  commitMessage: z.string().optional(),
  errors: pipelineErrors,
  ...pipelineTiming,
})
export type ForgePipeline = z.infer<typeof forgePipelineSchema>
export const forgePipelinePageSchema = z.object({
  items: z.array(forgePipelineSchema),
  next: z.string().optional(),
  ...cached,
})
export const forgePipelineStepSchema = z.object({
  id,
  name: z.string(),
  status: z.string(),
  number: z.number().int().nonnegative().optional(),
  url: url.optional(),
  errors: pipelineErrors,
  ...pipelineTiming,
})
export type ForgePipelineStep = z.infer<typeof forgePipelineStepSchema>
export const forgePipelineJobSchema = z.object({
  id,
  name: z.string(),
  status: z.string(),
  url,
  runner: z.string().optional(),
  steps: z.array(forgePipelineStepSchema).optional(),
  errors: pipelineErrors,
  ...pipelineTiming,
})
export type ForgePipelineJob = z.infer<typeof forgePipelineJobSchema>
export const forgePipelineDetailSchema = z.object({
  run: forgePipelineSchema,
  jobs: z.array(forgePipelineJobSchema),
  next: z.string().optional(),
  ...cached,
})
export type ForgePipelineDetail = z.infer<typeof forgePipelineDetailSchema>
export const forgeDefinitionsSchema = z.object({
  items: z.array(z.object({ id, name: z.string(), state: z.string().optional() })),
  next: z.string().optional(),
  manual: z.boolean().default(false),
  hint: z.string().optional(),
})
export const forgePipelineActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('run'),
    definition: id,
    ref: id,
    inputs: z
      .record(z.string().min(1).max(100), z.string().max(10000))
      .refine((v) => Object.keys(v).length <= 100, 'Use at most 100 pipeline inputs')
      .default({}),
  }),
  z.object({ action: z.literal('rerun'), id }),
  z.object({ action: z.literal('cancel'), id }),
  z.object({ action: z.literal('enable'), id }),
  z.object({ action: z.literal('disable'), id }),
])
export type ForgePipelineAction = z.infer<typeof forgePipelineActionSchema>
export const forgeWorkResultSchema = z.object({
  id: id.optional(),
  url: url.optional(),
  message: z.string(),
})
export type ForgeWorkResult = z.infer<typeof forgeWorkResultSchema>
