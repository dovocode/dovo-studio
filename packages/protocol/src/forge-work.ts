import { mutableStruct, mutableArray } from './schema.js'
import { minValue, maxValue, refine, urlSchema } from './schema.js'
import { Schema } from 'effect'
import { forgeProviderSchema } from './forges.js'
const id = refine(
  maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 300),
  (value) => !/[\p{Cc}]/u.test(value) && !['.', '..'].includes(value),
)
const url = refine(
  urlSchema({
    protocol: /^https?$/,
  }),
  (value) => {
    try {
      const parsed = new URL(value)
      return !parsed.username && !parsed.password
    } catch {
      return false
    }
  },
)
const cached = {
  cachedAt: Schema.optional(Schema.String),
  stale: Schema.optional(Schema.Boolean),
  refreshError: Schema.optional(Schema.String),
}
export const forgeWorkQuerySchema = mutableStruct({
  cursor: Schema.optional(maxValue(Schema.String, 4000)),
  query: Schema.optional(maxValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 300)),
  state: Schema.optionalWith(maxValue(Schema.String, 100), {
    default: () => 'open',
  }),
  refresh: Schema.optionalWith(Schema.Boolean, {
    default: () => false,
  }),
})
export const forgeWorkOptionsSchema = mutableStruct({
  provider: Schema.Union(forgeProviderSchema, Schema.Literal('jira')),
  issues: Schema.Boolean,
  issueNotice: Schema.optional(Schema.String),
  issueTypes: Schema.optionalWith(mutableArray(Schema.String), {
    default: () => [],
  }),
  issueStates: Schema.optionalWith(mutableArray(Schema.String), {
    default: () => [],
  }),
  issueSearch: Schema.optional(Schema.Boolean),
  assignees: Schema.optionalWith(Schema.Boolean, {
    default: () => true,
  }),
  labels: Schema.optionalWith(Schema.Boolean, {
    default: () => false,
  }),
  pipelines: Schema.Boolean,
  pipelineNotice: Schema.optional(Schema.String),
  pipelineActions: mutableArray(Schema.Literal('run', 'rerun', 'cancel', 'enable', 'disable')),
})
export type ForgeWorkOptions = Schema.Schema.Type<typeof forgeWorkOptionsSchema>
export const forgeIssueSchema = mutableStruct({
  id,
  title: Schema.String,
  body: Schema.String,
  state: Schema.String,
  type: Schema.optionalWith(Schema.String, {
    default: () => 'Issue',
  }),
  url,
  author: Schema.String,
  priority: Schema.optional(Schema.String),
  assignees: mutableArray(Schema.String),
  assigneeNames: Schema.optional(mutableArray(Schema.String)),
  labels: mutableArray(Schema.String),
  updatedAt: Schema.String,
  revision: Schema.String,
  bodyFormat: Schema.optionalWith(Schema.Literal('markdown', 'html'), {
    default: () => 'markdown',
  }),
  preview: Schema.optional(Schema.String),
  bodyNotice: Schema.optional(Schema.String),
})
export type ForgeIssue = Schema.Schema.Type<typeof forgeIssueSchema>
export const forgeIssuePageSchema = mutableStruct({
  items: mutableArray(forgeIssueSchema),
  next: Schema.optional(Schema.String),
  ...cached,
})
export const forgeIssueDetailSchema = mutableStruct({
  issue: forgeIssueSchema,
  discussionNotice: Schema.optional(Schema.String),
  comments: mutableArray(
    mutableStruct({
      id,
      body: Schema.String,
      author: Schema.String,
      createdAt: Schema.String,
      url: Schema.optional(url),
      bodyFormat: Schema.optionalWith(Schema.Literal('markdown', 'html'), {
        default: () => 'markdown',
      }),
    }),
  ),
  next: Schema.optional(Schema.String),
  ...cached,
})
export type ForgeIssueDetail = Schema.Schema.Type<typeof forgeIssueDetailSchema>
const fields = {
  title: maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 1000),
  body: maxValue(Schema.String, 100000),
  assignees: maxValue(
    mutableArray(maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 300)),
    20,
  ),
  labels: maxValue(
    mutableArray(maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 100)),
    100,
  ),
}
export const forgeIssueCreateSchema = mutableStruct({
  ...fields,
  assignees: Schema.optionalWith(fields.assignees, {
    default: () => [],
  }),
  labels: Schema.optionalWith(fields.labels, {
    default: () => [],
  }),
  type: Schema.optionalWith(maxValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 100), {
    default: () => 'Issue',
  }),
})
export type ForgeIssueCreate = Schema.Schema.Type<typeof forgeIssueCreateSchema>
export const forgeIssueActionSchema = Schema.Union(
  ...[
    mutableStruct({
      action: Schema.Literal('edit'),
      id,
      revision: id,
      title: Schema.optional(fields.title),
      body: Schema.optional(fields.body),
      state: Schema.optional(
        maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 100),
      ),
      assignees: Schema.optional(fields.assignees),
      labels: Schema.optional(fields.labels),
    }),
    mutableStruct({
      action: Schema.Literal('comment'),
      id,
      revision: id,
      body: maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 100000),
    }),
  ],
)
export type ForgeIssueAction = Schema.Schema.Type<typeof forgeIssueActionSchema>
const pipelineTiming = {
  startedAt: Schema.optional(Schema.String),
  completedAt: Schema.optional(Schema.String),
}
const pipelineErrors = Schema.optional(maxValue(mutableArray(maxValue(Schema.String, 2000)), 10))
export const forgePipelineSchema = mutableStruct({
  id,
  title: Schema.String,
  url,
  ref: Schema.String,
  sha: Schema.String,
  actor: Schema.String,
  status: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  definition: Schema.optional(Schema.String),
  number: Schema.optional(Schema.String),
  attempt: Schema.optional(
    Schema.Number.pipe(Schema.finite())
      .pipe(Schema.int(), Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
      .pipe(Schema.positive()),
  ),
  event: Schema.optional(Schema.String),
  workflow: Schema.optional(Schema.String),
  commitMessage: Schema.optional(Schema.String),
  errors: pipelineErrors,
  ...pipelineTiming,
})
export type ForgePipeline = Schema.Schema.Type<typeof forgePipelineSchema>
export const forgePipelinePageSchema = mutableStruct({
  items: mutableArray(forgePipelineSchema),
  next: Schema.optional(Schema.String),
  ...cached,
})
export const forgePipelineStepSchema = mutableStruct({
  id,
  name: Schema.String,
  status: Schema.String,
  number: Schema.optional(
    Schema.Number.pipe(Schema.finite())
      .pipe(Schema.int(), Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
      .pipe(Schema.nonNegative()),
  ),
  url: Schema.optional(url),
  errors: pipelineErrors,
  ...pipelineTiming,
})
export type ForgePipelineStep = Schema.Schema.Type<typeof forgePipelineStepSchema>
export const forgePipelineJobSchema = mutableStruct({
  id,
  name: Schema.String,
  status: Schema.String,
  url,
  runner: Schema.optional(Schema.String),
  steps: Schema.optional(mutableArray(forgePipelineStepSchema)),
  errors: pipelineErrors,
  ...pipelineTiming,
})
export type ForgePipelineJob = Schema.Schema.Type<typeof forgePipelineJobSchema>
export const forgePipelineDetailSchema = mutableStruct({
  run: forgePipelineSchema,
  jobs: mutableArray(forgePipelineJobSchema),
  next: Schema.optional(Schema.String),
  ...cached,
})
export type ForgePipelineDetail = Schema.Schema.Type<typeof forgePipelineDetailSchema>
export const forgeDefinitionsSchema = mutableStruct({
  items: mutableArray(
    mutableStruct({
      id,
      name: Schema.String,
      state: Schema.optional(Schema.String),
    }),
  ),
  next: Schema.optional(Schema.String),
  manual: Schema.optionalWith(Schema.Boolean, {
    default: () => false,
  }),
  hint: Schema.optional(Schema.String),
})
export const forgePipelineActionSchema = Schema.Union(
  ...[
    mutableStruct({
      action: Schema.Literal('run'),
      definition: id,
      ref: id,
      inputs: Schema.optionalWith(
        refine(
          Schema.mutable(
            Schema.Record({
              key: maxValue(minValue(Schema.String, 1), 100),
              value: maxValue(Schema.String, 10000),
            }),
          ),
          (v) => Object.keys(v).length <= 100,
          'Use at most 100 pipeline inputs',
        ),
        {
          default: () => ({}),
        },
      ),
    }),
    mutableStruct({
      action: Schema.Literal('rerun'),
      id,
    }),
    mutableStruct({
      action: Schema.Literal('cancel'),
      id,
    }),
    mutableStruct({
      action: Schema.Literal('enable'),
      id,
    }),
    mutableStruct({
      action: Schema.Literal('disable'),
      id,
    }),
  ],
)
export type ForgePipelineAction = Schema.Schema.Type<typeof forgePipelineActionSchema>
export const forgeWorkResultSchema = mutableStruct({
  id: Schema.optional(id),
  url: Schema.optional(url),
  message: Schema.String,
})
export type ForgeWorkResult = Schema.Schema.Type<typeof forgeWorkResultSchema>
