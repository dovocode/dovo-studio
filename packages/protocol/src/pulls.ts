import { z } from 'zod'
import { taskHarnessSchema, taskPullSchema } from './workspace.js'
import { forgeCapabilitiesSchema, forgeProviderSchema } from './forges.js'
const link = z.url({ protocol: /^https?$/ })
export const pullSummarySchema = z.object({
  provider: forgeProviderSchema.optional(),
  number: z.number().int().positive(),
  title: z.string(),
  url: link,
  state: z.enum(['open', 'closed', 'merged']),
  draft: z.boolean(),
  author: z.string(),
  updatedAt: z.string(),
  head: z.string(),
  base: z.string(),
  labels: z.array(z.string()),
  viewerIsAuthor: z.boolean().optional(),
  viewerReviewRequested: z.boolean().optional(),
  checksState: z.string().nullable().optional(),
  reviewDecision: z.string().nullable().optional(),
  statusError: z.string().optional(),
})
export const pullPageSchema = z.object({
  cachedAt: z.string().optional(),
  stale: z.boolean().optional(),
  refreshError: z.string().optional(),
  pulls: z.array(pullSummarySchema),
  hasMore: z.boolean(),
  page: z.number(),
})
export const pullCommentSchema = z.object({
  threadId: z.string().optional(),
  resolved: z.boolean().optional(),
  canResolve: z.boolean().optional(),
  outdated: z.boolean().optional(),
  commitId: z.string().optional(),
  id: z.string(),
  author: z.string(),
  body: z.string(),
  date: z.string(),
  url: link,
  kind: z.enum(['comment', 'review', 'inline']),
  state: z.string().optional(),
  path: z.string().optional(),
  line: z.number().nullish(),
  replyTo: z.string().optional(),
  diff: z.string().optional(),
})
export const pullDetailSchema = z.object({
  capabilities: forgeCapabilitiesSchema.optional(),
  fileBaseUrl: link.optional(),
  cachedAt: z.string().optional(),
  stale: z.boolean().optional(),
  refreshError: z.string().optional(),
  pull: pullSummarySchema.extend({
    ...taskPullSchema.pick({ headSha: true, baseSha: true, repositoryUrl: true }).shape,
    ...taskPullSchema.pick({ provider: true, connectionId: true, headRef: true, cloneUrl: true })
      .shape,
    body: z.string(),
    additions: z.number().nullable(),
    deletions: z.number().nullable(),
    changedFiles: z.number().nullable(),
    mergeable: z.boolean().nullable(),
    reviewers: z.array(z.string()),
    assignees: z.array(z.string()),
  }),
  comments: z.array(pullCommentSchema),
  files: z.array(
    z.object({
      path: z.string(),
      previousPath: z.string().optional(),
      status: z.string(),
      additions: z.number().nullable(),
      deletions: z.number().nullable(),
      patch: z.string().optional(),
    }),
  ),
  checks: z.array(
    z.object({
      name: z.string(),
      status: z.string(),
      url: link.optional(),
      id: z.string().optional(),
      summary: z.string().optional(),
      details: z.string().optional(),
      startedAt: z.string().optional(),
      completedAt: z.string().optional(),
      annotations: z
        .array(
          z.object({
            path: z.string(),
            startLine: z.number(),
            endLine: z.number(),
            level: z.string(),
            message: z.string(),
            title: z.string().optional(),
          }),
        )
        .optional(),
    }),
  ),
  warnings: z.array(z.string()),
})
export type PullSummary = z.infer<typeof pullSummarySchema>
export type PullPage = z.infer<typeof pullPageSchema>
export type PullDetail = z.infer<typeof pullDetailSchema>
export type PullComment = z.infer<typeof pullCommentSchema>

export const pullTaskInputSchema = z
  .object({
    number: z.number().int().positive(),
    agentId: z.string().max(200).default(''),
    harness: taskHarnessSchema.optional(),
    objective: z.string().trim().min(1).max(12000),
    headSha: taskPullSchema.shape.headSha,
    run: z.boolean().default(false),
  })
  .refine((input) => !(input.agentId && input.harness), {
    path: ['agentId'],
    message: 'Choose either a saved agent or a built-in harness',
  })
export const pullTaskResponse = z.object({ id: z.string(), error: z.string().optional() })
// Synthetic safe headers preserve GitHub hunk coordinates; the UI displays the real path separately.
export function pullFilePatch(file: Pick<PullDetail['files'][number], 'patch' | 'status'>) {
  return `--- ${file.status === 'added' ? '/dev/null' : 'a/file'}\n+++ ${file.status === 'removed' ? '/dev/null' : 'b/file'}\n${file.patch ?? ''}\n`
}

export const pullLineCommentSchema = z
  .object({
    number: z.number().int().positive(),
    headSha: taskPullSchema.shape.headSha,
    path: z.string().min(1),
    side: z.enum(['additions', 'deletions']),
    start: z.number().int().positive(),
    end: z.number().int().positive(),
    body: z.string().trim().min(1).max(10000),
  })
  .refine((v) => v.end >= v.start, 'Invalid line range')
export const pullLineCommentResponse = z.object({ url: link })
