import { supportsAccess, supportsUtilities } from '../auth/access.js'
import type { Agent } from '../workspace.js'
import { MAX_ATTACHMENT_BYTES } from '../shared/attachments.js'
import { Effect, Schema } from 'effect'
import { mutableArray, mutableStruct, strictStruct, minValue, maxValue } from '../shared/schema.js'
import { titleGenerationSettingsSchema } from '../tasks/title-generation.js'
import { codeFindingSchema, codeReviewOutputSchema } from './task-review.js'
import { forgeIdentityTokenSchema } from './forges/source-identity.js'

const id = maxValue(minValue(Schema.String, 1), 4000)
const ids = maxValue(mutableArray(id), 100)
export const MAX_PULL_REVIEWERS = 4
export const MAX_PULL_REVIEW_IMAGES = 3
export const pullReviewImageSchema = strictStruct({
  mime: Schema.optional(Schema.Literals(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])),
  name: maxValue(minValue(Schema.String, 1), 250),
  data: maxValue(Schema.String, Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4),
})
export type PullReviewImage = typeof pullReviewImageSchema.Type
const reviewerSelections = maxValue(
  mutableArray(titleGenerationSettingsSchema),
  MAX_PULL_REVIEWERS - 1,
)
const imageMetadata = mutableStruct({
  id,
  name: Schema.String,
  mime: Schema.String,
  size: Schema.Int,
  digest: Schema.String,
})
const version = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
export const pullReviewDepthSchema = Schema.Literals(['quick', 'standard', 'thorough'])
export type PullReviewDepth = typeof pullReviewDepthSchema.Type
export const pullReviewDepths = {
  quick: {
    label: 'Quick',
    description: 'All eligible files. No tools or extra source context.',
    tools: false,
    contextFiles: 0,
    contextBudget: 0,
  },
  standard: {
    label: 'Standard',
    description: 'All eligible files with read-only tools and nearby source context.',
    tools: true,
    contextFiles: 12,
    contextBudget: 48_000,
  },
  thorough: {
    label: 'Deep',
    description: 'All eligible files with read-only tools and deeper source investigation.',
    tools: true,
    contextFiles: 32,
    contextBudget: 96_000,
  },
} satisfies Record<
  PullReviewDepth,
  {
    label: string
    description: string
    tools: boolean
    contextFiles: number
    contextBudget: number
  }
>
/** The stored thorough value stays compatible with existing reports and older clients. */
export function supportsPullReview(provider: Agent['provider'], depth: PullReviewDepth) {
  return depth === 'quick'
    ? supportsUtilities(provider)
    : provider !== 'pi' && supportsAccess(provider, 'read-only')
}
export const pullReviewCheckSchema = mutableStruct({
  name: Schema.String,
  command: Schema.String,
  headSha: Schema.String,
  status: Schema.Literals([
    'running',
    'passed',
    'failed',
    'skipped',
    'cancelled',
    'timed-out',
    'interrupted',
  ]),
  output: maxValue(Schema.String, 20000),
  exitCode: Schema.optional(Schema.Int),
  startedAt: Schema.optional(Schema.String),
  finishedAt: Schema.optional(Schema.String),
})
export const pullReviewCheckLabels: Record<typeof pullReviewCheckSchema.Type.status, string> = {
  running: 'Running',
  passed: 'Passed',
  failed: 'Failed',
  skipped: 'Skipped',
  cancelled: 'Cancelled',
  'timed-out': 'Timed out',
  interrupted: 'Interrupted',
}
export const pullCodeReviewTargetSchema = strictStruct({
  repositoryId: id,
  number: Schema.Int.check(Schema.isGreaterThan(0)),
  connectionId: Schema.optional(id),
  expectedDestination: forgeIdentityTokenSchema,
})
export type PullCodeReviewTarget = typeof pullCodeReviewTargetSchema.Type
const pullReviewStackMemberSchema = mutableStruct({
  target: pullCodeReviewTargetSchema,
  title: Schema.String,
  url: Schema.String,
  headSha: id,
  baseSha: id,
  parentNumber: Schema.optional(Schema.Int),
  requestId: id,
  reviewId: Schema.optional(id),
  status: Schema.Literals(['queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted']),
  findings: Schema.optional(version),
  suppliedFiles: Schema.optional(version),
  totalFiles: Schema.optional(version),
  error: Schema.optional(Schema.String),
})
export const pullReviewStackSchema = mutableStruct({
  id,
  sequence: version.pipe(Schema.withDecodingDefaultType(Effect.sync(() => 0))),
  requestId: id,
  fingerprint: Schema.String,
  destination: Schema.String,
  readerIdentity: Schema.String,
  rootNumber: Schema.Int,
  status: Schema.Literals(['running', 'completed', 'failed', 'cancelled', 'interrupted']),
  createdAt: Schema.String,
  finishedAt: Schema.optional(Schema.String),
  members: maxValue(mutableArray(pullReviewStackMemberSchema), 100),
})
export type PullReviewStack = typeof pullReviewStackSchema.Type
export const pullReviewStackContextSchema = mutableStruct({
  id,
  rootNumber: Schema.Int,
  readerIdentity: Schema.String,
  members: mutableArray(
    mutableStruct({
      number: Schema.Int,
      title: Schema.String,
      url: Schema.String,
      parentNumber: Schema.optional(Schema.Int),
      headSha: Schema.String,
      baseSha: Schema.String,
    }),
  ),
})
const findingFields = {
  path: codeFindingSchema.fields.path,
  line: codeFindingSchema.fields.line,
  severity: codeFindingSchema.fields.severity,
  title: codeFindingSchema.fields.title,
  trigger: codeFindingSchema.fields.trigger,
  impact: codeFindingSchema.fields.impact,
  suggestion: codeFindingSchema.fields.suggestion,
}
export const pullCodeReviewOutputSchema = mutableStruct({
  summary: codeReviewOutputSchema.fields.summary,
  notVerified: codeReviewOutputSchema.fields.notVerified,
  findings: maxValue(
    mutableArray(
      mutableStruct({
        ...findingFields,
        side: Schema.Literals(['before', 'after']),
        evidence: maxValue(minValue(Schema.String, 1), 2000),
        confidence: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10 })),
      }),
    ),
    100,
  ),
})
export const pullCodeReviewDraftSchema = mutableStruct({
  body: maxValue(Schema.String, 50000),
  selected: ids,
  dismissed: ids,
  event: Schema.Literals(['comment', 'request-changes']),
})
export type PullCodeReviewDraft = typeof pullCodeReviewDraftSchema.Type
export const pullCodeReviewSchema = mutableStruct({
  id,
  requestId: id,
  stack: Schema.optional(pullReviewStackContextSchema),
  remainingFrom: Schema.optional(id),
  revision: Schema.String,
  version,
  sequence: version.pipe(Schema.withDecodingDefaultType(Effect.sync(() => 0))),
  url: Schema.String,
  destination: Schema.String,
  readerIdentity: Schema.String,
  account: Schema.String,
  baseSha: Schema.String,
  headSha: Schema.String,
  selection: titleGenerationSettingsSchema,
  reviewers: Schema.optional(reviewerSelections),
  images: Schema.optional(mutableArray(imageMetadata)),
  reviewerResults: Schema.optional(
    mutableArray(
      mutableStruct({
        id,
        selection: titleGenerationSettingsSchema,
        status: Schema.Literals([
          'pending',
          'running',
          'completed',
          'partial',
          'failed',
          'cancelled',
          'interrupted',
        ]),
        completedBatches: version,
        batches: version,
        error: Schema.optional(Schema.String),
      }),
    ),
  ),
  depth: Schema.optional(pullReviewDepthSchema),
  runChecks: Schema.optional(Schema.Boolean),
  checks: Schema.optional(mutableArray(pullReviewCheckSchema)),
  createdAt: Schema.String,
  finishedAt: Schema.optional(Schema.String),
  status: Schema.Literals(['running', 'completed', 'failed', 'cancelled', 'interrupted']),
  error: Schema.optional(Schema.String),
  summary: Schema.String,
  intent: Schema.optional(mutableStruct({ title: Schema.String, body: Schema.String })),
  notVerified: mutableArray(Schema.String),
  analysis: Schema.optional(
    mutableStruct({
      batches: version,
      completedBatches: version,
      activeBatch: Schema.optional(version),
      phase: Schema.Literals(['reviewing', 'checking', 'combining', 'completed']),
      rejectedFindings: version,
      contextFiles: mutableArray(
        mutableStruct({ path: Schema.String, ref: Schema.String, text: Schema.String }),
      ),
    }),
  ),
  coverage: mutableArray(
    mutableStruct({
      path: Schema.String,
      state: Schema.Literals([
        'supplied',
        'queued',
        'budget',
        'too-large',
        'lockfile',
        'unavailable',
        'partial',
        'excluded',
        'previous-pass',
        'failed',
      ]),
      patch: Schema.optional(Schema.String),
      batch: Schema.optional(version),
    }),
  ),
  missingFiles: version,
  findings: mutableArray(
    mutableStruct({
      ...findingFields,
      id,
      reviewerIds: Schema.optional(mutableArray(id)),
      side: Schema.Literals(['before', 'after']),
      anchored: Schema.Boolean,
      evidence: Schema.optional(Schema.String),
      verification: Schema.optional(Schema.String),
      confidence: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10 }))),
    }),
  ),
  draft: pullCodeReviewDraftSchema,
  publication: Schema.optional(
    mutableStruct({
      requestId: id,
      body: Schema.String,
      event: Schema.Literals(['comment', 'request-changes']),
      status: Schema.Literals(['publishing', 'published', 'unknown']),
      url: Schema.optional(Schema.String),
      error: Schema.optional(Schema.String),
      notice: Schema.optional(Schema.String),
      pendingReviewDecision: Schema.optional(Schema.Literals(['approve', 'request-changes'])),
    }),
  ),
})
export type PullCodeReview = typeof pullCodeReviewSchema.Type
export const pullReviewerStatusLabels: Record<
  NonNullable<PullCodeReview['reviewerResults']>[number]['status'],
  string
> = {
  pending: 'Pending',
  running: 'Running',
  completed: 'Completed',
  partial: 'Partial',
  failed: 'Failed',
  cancelled: 'Cancelled',
  interrupted: 'Interrupted',
}
export const pullCodeReviewReportSchema = mutableStruct({
  reviews: mutableArray(pullCodeReviewSchema),
  oneRunSettingsSupported: Schema.optional(Schema.Boolean),
  stacks: Schema.optional(mutableArray(pullReviewStackSchema)),
  selection: Schema.optional(titleGenerationSettingsSchema),
  reviewers: Schema.optional(reviewerSelections),
  depth: Schema.optional(pullReviewDepthSchema),
})
export type PullCodeReviewReport = typeof pullCodeReviewReportSchema.Type
export const pullCodeReviewReadSchema = strictStruct({ target: pullCodeReviewTargetSchema })
export const pullCodeReviewStartSchema = strictStruct({
  target: pullCodeReviewTargetSchema,
  requestId: id,
  headSha: id,
  baseSha: id,
  selection: titleGenerationSettingsSchema,
  reviewers: Schema.optional(reviewerSelections),
  images: Schema.optional(maxValue(mutableArray(pullReviewImageSchema), MAX_PULL_REVIEW_IMAGES)),
  depth: Schema.optional(pullReviewDepthSchema),
  runChecks: Schema.optional(Schema.Boolean),
  remainingFrom: Schema.optional(id),
  fullStack: Schema.optional(Schema.Boolean),
  oneRunSettings: Schema.optional(Schema.Boolean),
})
export const pullCodeReviewStopSchema = strictStruct({
  target: pullCodeReviewTargetSchema,
  reviewId: id,
  stackId: Schema.optional(id),
})
export const pullCodeReviewSaveSchema = strictStruct({
  target: pullCodeReviewTargetSchema,
  reviewId: id,
  version,
  draft: pullCodeReviewDraftSchema,
})
export const pullCodeReviewPublishSchema = strictStruct({
  target: pullCodeReviewTargetSchema,
  reviewId: id,
  version,
  requestId: id,
  /** The exact text confirmed in the preview, including the recovery marker. */
  body: maxValue(Schema.String, 51000),
})

export function pullCodeReviewBody(review: Pick<PullCodeReview, 'id' | 'headSha' | 'draft'>) {
  return `${review.draft.body.trim()}\n\n<!-- dovo-review:${review.id}:${review.headSha} -->`
}

/** Generated text is quoted as plain text. User edits remain untouched. */
export function pullFindingText(finding: PullCodeReview['findings'][number]) {
  const plain = (text: string) =>
    text.replace(/([\\`*_{}[\]()<>!#|])/g, '\\$1').replace(/@/g, '@\u200b')
  return `### ${plain(finding.title)}\n\n${plain(finding.path)}${finding.anchored ? `:${finding.line} (${finding.side})` : ' (location not verified)'}\n\n${plain(finding.trigger)}\n\n${plain(finding.impact)}\n\n${plain(finding.suggestion)}`
}

export function pullReviewReferences(body: string) {
  return [
    ...new Set(
      body.match(/@[\w-]+(?:\/[\w-]+)?|(?:[\w.-]+\/[\w.-]+)?#\d+|https?:\/\/[^\s<>]+/g) ?? [],
    ),
  ]
}

/** Labels describe the measured evidence, rather than claiming model attention. */
export const pullReviewCoverageLabels: Record<PullCodeReview['coverage'][number]['state'], string> =
  {
    supplied: 'Patch supplied',
    queued: 'Waiting for review',
    budget: 'Not yet supplied',
    lockfile: 'Dependency lock file',
    'too-large': 'Patch exceeds review limit',
    partial: 'Incomplete forge patch',
    unavailable: 'No patch available',
    excluded: 'Excluded file',
    'previous-pass': 'Supplied in an earlier pass',
    failed: 'Review did not finish',
  }
