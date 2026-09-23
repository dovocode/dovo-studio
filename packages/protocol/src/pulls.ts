import { mutableArray, mutableStruct } from './schema.js'
import { urlSchema, maxValue, minValue, refine } from './schema.js'
import { Schema } from 'effect'
import { taskHarnessSchema, taskPullSchema } from './workspace.js'
import { forgeCapabilitiesSchema, forgeProviderSchema } from './forges.js'
const link = urlSchema({
  protocol: /^https?$/,
})
export const pullSummarySchema = mutableStruct({
  provider: Schema.optional(forgeProviderSchema),
  number: Schema.Number.pipe(Schema.finite())
    .pipe(Schema.int(), Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
    .pipe(Schema.positive()),
  title: Schema.String,
  url: link,
  state: Schema.Literal('open', 'closed', 'merged'),
  draft: Schema.Boolean,
  author: Schema.String,
  updatedAt: Schema.String,
  head: Schema.String,
  base: Schema.String,
  labels: mutableArray(Schema.String),
  viewerIsAuthor: Schema.optional(Schema.Boolean),
  viewerReviewRequested: Schema.optional(Schema.Boolean),
  checksState: Schema.optional(Schema.NullOr(Schema.String)),
  reviewDecision: Schema.optional(Schema.NullOr(Schema.String)),
  statusError: Schema.optional(Schema.String),
})
export const pullPageSchema = mutableStruct({
  cachedAt: Schema.optional(Schema.String),
  stale: Schema.optional(Schema.Boolean),
  refreshError: Schema.optional(Schema.String),
  pulls: mutableArray(pullSummarySchema),
  hasMore: Schema.Boolean,
  page: Schema.Number.pipe(Schema.finite()),
})
export const pullCommentSchema = mutableStruct({
  threadId: Schema.optional(Schema.String),
  resolved: Schema.optional(Schema.Boolean),
  canResolve: Schema.optional(Schema.Boolean),
  outdated: Schema.optional(Schema.Boolean),
  commitId: Schema.optional(Schema.String),
  id: Schema.String,
  author: Schema.String,
  body: Schema.String,
  date: Schema.String,
  url: link,
  kind: Schema.Literal('comment', 'review', 'inline'),
  state: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  line: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.finite()))),
  replyTo: Schema.optional(Schema.String),
  diff: Schema.optional(Schema.String),
})
export const pullDetailSchema = mutableStruct({
  capabilities: Schema.optional(forgeCapabilitiesSchema),
  fileBaseUrl: Schema.optional(link),
  cachedAt: Schema.optional(Schema.String),
  stale: Schema.optional(Schema.Boolean),
  refreshError: Schema.optional(Schema.String),
  pull: mutableStruct({
    ...pullSummarySchema.fields,
    ...{
      ...taskPullSchema.pick('headSha', 'baseSha', 'repositoryUrl').fields,
      ...taskPullSchema.pick('provider', 'connectionId', 'headRef', 'cloneUrl').fields,
      body: Schema.String,
      additions: Schema.NullOr(Schema.Number.pipe(Schema.finite())),
      deletions: Schema.NullOr(Schema.Number.pipe(Schema.finite())),
      changedFiles: Schema.NullOr(Schema.Number.pipe(Schema.finite())),
      mergeable: Schema.NullOr(Schema.Boolean),
      reviewers: mutableArray(Schema.String),
      assignees: mutableArray(Schema.String),
    },
  }),
  comments: mutableArray(pullCommentSchema),
  files: mutableArray(
    mutableStruct({
      path: Schema.String,
      previousPath: Schema.optional(Schema.String),
      status: Schema.String,
      additions: Schema.NullOr(Schema.Number.pipe(Schema.finite())),
      deletions: Schema.NullOr(Schema.Number.pipe(Schema.finite())),
      patch: Schema.optional(Schema.String),
    }),
  ),
  checks: mutableArray(
    mutableStruct({
      name: Schema.String,
      status: Schema.String,
      url: Schema.optional(link),
      id: Schema.optional(Schema.String),
      summary: Schema.optional(Schema.String),
      details: Schema.optional(Schema.String),
      startedAt: Schema.optional(Schema.String),
      completedAt: Schema.optional(Schema.String),
      annotations: Schema.optional(
        mutableArray(
          mutableStruct({
            path: Schema.String,
            startLine: Schema.Number.pipe(Schema.finite()),
            endLine: Schema.Number.pipe(Schema.finite()),
            level: Schema.String,
            message: Schema.String,
            title: Schema.optional(Schema.String),
          }),
        ),
      ),
    }),
  ),
  warnings: mutableArray(Schema.String),
})
export type PullSummary = Schema.Schema.Type<typeof pullSummarySchema>
export type PullPage = Schema.Schema.Type<typeof pullPageSchema>
export type PullDetail = Schema.Schema.Type<typeof pullDetailSchema>
export type PullComment = Schema.Schema.Type<typeof pullCommentSchema>
export const pullTaskInputSchema = refine(
  mutableStruct({
    number: Schema.Number.pipe(Schema.finite())
      .pipe(Schema.int(), Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
      .pipe(Schema.positive()),
    agentId: Schema.optionalWith(maxValue(Schema.String, 200), {
      default: () => '',
    }),
    harness: Schema.optional(taskHarnessSchema),
    objective: maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 12000),
    headSha: taskPullSchema.fields.headSha,
    run: Schema.optionalWith(Schema.Boolean, {
      default: () => false,
    }),
  }),
  (input) => !(input.agentId && input.harness),
  {
    path: ['agentId'],
    message: 'Choose either a saved agent or a built-in harness',
  },
)
export const pullTaskResponse = mutableStruct({
  id: Schema.String,
  error: Schema.optional(Schema.String),
})
// Synthetic safe headers preserve GitHub hunk coordinates; the UI displays the real path separately.
export function pullFilePatch(file: Pick<PullDetail['files'][number], 'patch' | 'status'>) {
  return `--- ${file.status === 'added' ? '/dev/null' : 'a/file'}\n+++ ${file.status === 'removed' ? '/dev/null' : 'b/file'}\n${file.patch ?? ''}\n`
}
export const pullLineCommentSchema = refine(
  mutableStruct({
    number: Schema.Number.pipe(Schema.finite())
      .pipe(Schema.int(), Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
      .pipe(Schema.positive()),
    headSha: taskPullSchema.fields.headSha,
    path: minValue(Schema.String, 1),
    side: Schema.Literal('additions', 'deletions'),
    start: Schema.Number.pipe(Schema.finite())
      .pipe(Schema.int(), Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
      .pipe(Schema.positive()),
    end: Schema.Number.pipe(Schema.finite())
      .pipe(Schema.int(), Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
      .pipe(Schema.positive()),
    body: maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 10000),
  }),
  (v) => v.end >= v.start,
  'Invalid line range',
)
export const pullLineCommentResponse = mutableStruct({
  url: link,
})
