import { Effect, Schema } from 'effect'
import { mutableArray, mutableStruct, strictStruct, minValue, maxValue } from '../shared/schema.js'
import { titleGenerationSettingsSchema } from '../tasks/title-generation.js'
import { codeFindingSchema, codeReviewOutputSchema } from './task-review.js'
import { forgeIdentityTokenSchema } from './forges/source-identity.js'

const id = maxValue(minValue(Schema.String, 1), 4000)
const ids = maxValue(mutableArray(id), 100)
const version = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
export const pullCodeReviewTargetSchema = strictStruct({
  repositoryId: id,
  number: Schema.Int.check(Schema.isGreaterThan(0)),
  connectionId: Schema.optional(id),
  expectedDestination: forgeIdentityTokenSchema,
})
export type PullCodeReviewTarget = typeof pullCodeReviewTargetSchema.Type
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
      phase: Schema.Literals(['reviewing', 'checking', 'completed']),
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
export const pullCodeReviewReportSchema = mutableStruct({
  reviews: mutableArray(pullCodeReviewSchema),
  selection: Schema.optional(titleGenerationSettingsSchema),
})
export type PullCodeReviewReport = typeof pullCodeReviewReportSchema.Type
export const pullCodeReviewReadSchema = strictStruct({ target: pullCodeReviewTargetSchema })
export const pullCodeReviewStartSchema = strictStruct({
  target: pullCodeReviewTargetSchema,
  requestId: id,
  headSha: id,
  baseSha: id,
  selection: titleGenerationSettingsSchema,
  remainingFrom: Schema.optional(id),
})
export const pullCodeReviewStopSchema = strictStruct({
  target: pullCodeReviewTargetSchema,
  reviewId: id,
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
    'too-large': 'Patch exceeds review limit',
    partial: 'Incomplete forge patch',
    unavailable: 'No patch available',
    excluded: 'Generated, vendored or binary',
    'previous-pass': 'Supplied in an earlier pass',
    failed: 'Review did not finish',
  }
