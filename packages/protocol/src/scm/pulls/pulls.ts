import { forgeDestinationGuardFields, forgeIdentityTokenSchema } from '../forges/source-identity.js'
import { pullStackSchema, pullStackSummarySchema } from './pull-stack.js'
import { mutableArray, mutableStruct } from '../../shared/schema.js'
import { urlSchema, maxValue, minValue, refine } from '../../shared/schema.js'
import { Schema, Effect, Struct } from 'effect'
import { taskHarnessSchema, taskPullSchema } from '../../workspace.js'
import { forgeCapabilitiesSchema, forgeProviderSchema } from '../forges/forges.js'
const link = urlSchema({
  protocol: /^https?$/,
})
export const pullSummarySchema = mutableStruct({
  destination: Schema.optional(forgeIdentityTokenSchema),
  additions: Schema.optional(
    Schema.NullOr(
      Schema.Number.pipe(
        Schema.check(Schema.isFinite()),
        Schema.check(Schema.isInt()),
        Schema.check(Schema.isGreaterThanOrEqualTo(0)),
      ),
    ),
  ),
  deletions: Schema.optional(
    Schema.NullOr(
      Schema.Number.pipe(
        Schema.check(Schema.isFinite()),
        Schema.check(Schema.isInt()),
        Schema.check(Schema.isGreaterThanOrEqualTo(0)),
      ),
    ),
  ),
  commentCount: Schema.optional(
    Schema.NullOr(
      Schema.Number.pipe(
        Schema.check(Schema.isFinite()),
        Schema.check(Schema.isInt()),
        Schema.check(Schema.isGreaterThanOrEqualTo(0)),
      ),
    ),
  ),
  stack: Schema.optional(pullStackSummarySchema),
  provider: Schema.optional(forgeProviderSchema),
  number: Schema.Number.pipe(Schema.check(Schema.isFinite()))
    .pipe(
      Schema.check(Schema.isInt()),
      Schema.check(
        Schema.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
      ),
    )
    .pipe(Schema.check(Schema.isGreaterThan(0))),
  title: Schema.String,
  url: link,
  state: Schema.Literals(['open', 'closed', 'merged']),
  draft: Schema.Boolean,
  author: Schema.String,
  authorAvatarUrl: Schema.optional(link),
  updatedAt: Schema.String,
  head: Schema.String,
  base: Schema.String,
  labels: mutableArray(Schema.String),
  viewerIsAuthor: Schema.optional(Schema.Boolean),
  viewerIsAssigned: Schema.optional(Schema.Boolean),
  viewerIsInvolved: Schema.optional(Schema.Boolean),
  viewerReviewRequested: Schema.optional(Schema.Boolean),
  checksState: Schema.optional(Schema.NullOr(Schema.String)),
  reviewDecision: Schema.optional(Schema.NullOr(Schema.String)),
  statusError: Schema.optional(Schema.String),
})
export const pullPageSchema = mutableStruct({
  paginationNotice: Schema.optional(maxValue(Schema.String, 1024)),
  destination: Schema.optional(forgeIdentityTokenSchema),
  cachedAt: Schema.optional(Schema.String),
  stale: Schema.optional(Schema.Boolean),
  refreshError: Schema.optional(Schema.String),
  pulls: mutableArray(pullSummarySchema),
  hasMore: Schema.Boolean,
  page: Schema.Number.pipe(Schema.check(Schema.isFinite())),
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
  kind: Schema.Literals(['comment', 'review', 'inline']),
  state: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  line: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.check(Schema.isFinite())))),
  replyTo: Schema.optional(Schema.String),
  diff: Schema.optional(Schema.String),
})
/** Independently loaded PR resources. Omitting section retains the complete-detail API. */
export const pullDetailSectionSchema = Schema.Literals([
  'overview',
  'status',
  'discussion',
  'changes',
  'checks',
  'stack',
])
export type PullDetailSection = typeof pullDetailSectionSchema.Type
export function pullRevision(detail: Pick<PullDetail, 'pull'>) {
  return `${detail.pull.headSha}:${detail.pull.baseSha}`
}

export const pullDetailSchema = mutableStruct({
  destination: Schema.optional(forgeIdentityTokenSchema),
  stack: Schema.optional(pullStackSchema),
  capabilities: Schema.optional(forgeCapabilitiesSchema),
  fileBaseUrl: Schema.optional(link),
  cachedAt: Schema.optional(Schema.String),
  stale: Schema.optional(Schema.Boolean),
  refreshError: Schema.optional(Schema.String),
  pull: mutableStruct({
    ...pullSummarySchema.fields,
    ...{
      ...taskPullSchema.mapFields(Struct.pick(['headSha', 'baseSha', 'repositoryUrl'])).fields,
      ...taskPullSchema.mapFields(
        Struct.pick(['provider', 'connectionId', 'headRef', 'cloneUrl', 'headCloneUrl']),
      ).fields,
      body: Schema.String,
      additions: Schema.NullOr(Schema.Number.pipe(Schema.check(Schema.isFinite()))),
      deletions: Schema.NullOr(Schema.Number.pipe(Schema.check(Schema.isFinite()))),
      changedFiles: Schema.NullOr(Schema.Number.pipe(Schema.check(Schema.isFinite()))),
      mergeable: Schema.NullOr(Schema.Boolean),
      mergeStateStatus: Schema.optional(Schema.String),
      mergeReadinessError: Schema.optional(Schema.String),
      autoMergeEnabled: Schema.optional(Schema.Boolean),
      inMergeQueue: Schema.optional(Schema.Boolean),
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
      additions: Schema.NullOr(Schema.Number.pipe(Schema.check(Schema.isFinite()))),
      deletions: Schema.NullOr(Schema.Number.pipe(Schema.check(Schema.isFinite()))),
      patch: Schema.optional(Schema.String),
      attributes: Schema.optional(
        mutableStruct({
          binary: Schema.Boolean,
          generated: Schema.Boolean,
          vendored: Schema.Boolean,
        }),
      ),
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
            startLine: Schema.Number.pipe(Schema.check(Schema.isFinite())),
            endLine: Schema.Number.pipe(Schema.check(Schema.isFinite())),
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
/** Never put comments or code from a different revision/account onto the current overview. */
export function matchingPullSection(overview: PullDetail | null, section: PullDetail | null) {
  return (
    !!overview &&
    !!section &&
    overview.pull.url === section.pull.url &&
    overview.destination === section.destination &&
    pullRevision(overview) === pullRevision(section)
  )
}
export function combinePullSections(
  overview: PullDetail | null,
  sections: Partial<Record<PullDetailSection, PullDetail | null>>,
): PullDetail | null {
  if (!overview) return null
  const get = (key: PullDetailSection) => {
    const value = sections[key]
    return value && matchingPullSection(overview, value) ? value : undefined
  }
  const status = get('status'),
    discussion = get('discussion'),
    changes = get('changes'),
    checks = get('checks'),
    stack = get('stack')
  const overviewUpdated = Date.parse(overview.pull.updatedAt)
  const statusUpdated = status ? Date.parse(status.pull.updatedAt) : NaN
  // Reopening or changing draft state does not change the head/base revision.
  // An older cached status must not undo a fresher overview's lifecycle state.
  const lifecycleStatus =
    status &&
    !(
      Number.isFinite(overviewUpdated) &&
      Number.isFinite(statusUpdated) &&
      statusUpdated < overviewUpdated
    )
      ? status
      : undefined
  return {
    ...overview,
    capabilities: lifecycleStatus?.capabilities
      ? {
          ...lifecycleStatus.capabilities,
          actions: [
            ...lifecycleStatus.capabilities.actions,
            ...(discussion?.capabilities?.actions.includes('resolve') ? ['resolve' as const] : []),
          ],
        }
      : overview.capabilities,
    pull: {
      ...overview.pull,
      state: lifecycleStatus ? lifecycleStatus.pull.state : overview.pull.state,
      draft: lifecycleStatus ? lifecycleStatus.pull.draft : overview.pull.draft,
      mergeable: lifecycleStatus ? lifecycleStatus.pull.mergeable : overview.pull.mergeable,
      checksState: status ? status.pull.checksState : overview.pull.checksState,
      reviewDecision: status ? status.pull.reviewDecision : overview.pull.reviewDecision,
      statusError: status ? status.pull.statusError : overview.pull.statusError,
      mergeStateStatus: lifecycleStatus
        ? lifecycleStatus.pull.mergeStateStatus
        : overview.pull.mergeStateStatus,
      mergeReadinessError: lifecycleStatus
        ? lifecycleStatus.pull.mergeReadinessError
        : overview.pull.mergeReadinessError,
      autoMergeEnabled: lifecycleStatus
        ? lifecycleStatus.pull.autoMergeEnabled
        : overview.pull.autoMergeEnabled,
      inMergeQueue: lifecycleStatus
        ? lifecycleStatus.pull.inMergeQueue
        : overview.pull.inMergeQueue,
      stack: stack?.pull.stack,
    },
    stack: stack?.stack,
    comments: discussion?.comments ?? [],
    files: changes?.files ?? [],
    checks: checks?.checks ?? [],
  }
}

/** Keep the review layout while a new revision loads, without mixing accounts or revisions. */
export function pullChangesSnapshot(
  current: PullDetail | null,
  ready: boolean,
  previous: PullDetail | null,
): PullDetail | null {
  if (ready) return current
  if (
    !current?.destination ||
    previous?.destination !== current.destination ||
    previous.pull.url !== current.pull.url ||
    previous.pull.connectionId !== current.pull.connectionId
  )
    return null
  return { ...previous, stale: true }
}

export const pullTaskInputSchema = refine(
  mutableStruct({
    ...forgeDestinationGuardFields,
    number: Schema.Number.pipe(Schema.check(Schema.isFinite()))
      .pipe(
        Schema.check(Schema.isInt()),
        Schema.check(
          Schema.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
        ),
      )
      .pipe(Schema.check(Schema.isGreaterThan(0))),
    agentId: maxValue(Schema.String, 200).pipe(
      Schema.withDecodingDefaultType(Effect.sync(() => '')),
    ),
    harness: Schema.optional(taskHarnessSchema),
    stackAction: Schema.optional(Schema.Literal('update')),
    checkoutMode: taskPullSchema.fields.checkoutMode,
    objective: maxValue(minValue(Schema.String.pipe(Schema.decodeTo(Schema.Trim)), 1), 12000),
    headSha: taskPullSchema.fields.headSha,
    run: Schema.Boolean.pipe(Schema.withDecodingDefaultType(Effect.sync(() => false))),
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
    ...forgeDestinationGuardFields,
    connectionId: Schema.optional(maxValue(minValue(Schema.String, 1), 200)),
    number: Schema.Number.pipe(Schema.check(Schema.isFinite()))
      .pipe(
        Schema.check(Schema.isInt()),
        Schema.check(
          Schema.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
        ),
      )
      .pipe(Schema.check(Schema.isGreaterThan(0))),
    headSha: taskPullSchema.fields.headSha,
    path: minValue(Schema.String, 1),
    side: Schema.Literals(['additions', 'deletions']),
    start: Schema.Number.pipe(Schema.check(Schema.isFinite()))
      .pipe(
        Schema.check(Schema.isInt()),
        Schema.check(
          Schema.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
        ),
      )
      .pipe(Schema.check(Schema.isGreaterThan(0))),
    end: Schema.Number.pipe(Schema.check(Schema.isFinite()))
      .pipe(
        Schema.check(Schema.isInt()),
        Schema.check(
          Schema.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
        ),
      )
      .pipe(Schema.check(Schema.isGreaterThan(0))),
    body: maxValue(minValue(Schema.String.pipe(Schema.decodeTo(Schema.Trim)), 1), 10000),
  }),
  (v) => v.end >= v.start,
  'Invalid line range',
)
export const pullLineCommentResponse = mutableStruct({
  url: link,
})
