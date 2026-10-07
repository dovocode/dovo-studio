import { mutableStruct, mutableArray } from '@dovo/protocol'
import { urlSchema } from '@dovo/protocol'
import { Schema, Effect } from 'effect'
const link = urlSchema({
  protocol: /^https?$/,
})
const count = Schema.optional(
  Schema.NullOr(
    Schema.Number.pipe(Schema.check(Schema.isFinite()))
      .pipe(
        Schema.check(Schema.isInt()),
        Schema.check(
          Schema.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
        ),
      )
      .pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  ),
)
export const forgeUser = mutableStruct({
  login: Schema.String,
})
export const forgeRepository = mutableStruct({
  id: Schema.Number.pipe(Schema.check(Schema.isFinite())).pipe(
    Schema.check(Schema.isInt()),
    Schema.check(
      Schema.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
    ),
  ),
  name: Schema.String,
  full_name: Schema.String,
  html_url: link,
  clone_url: link,
  default_branch: Schema.optional(Schema.String),
  allow_merge_commits: Schema.optional(Schema.Boolean),
  allow_squash_merge: Schema.optional(Schema.Boolean),
  allow_rebase: Schema.optional(Schema.Boolean),
})
const branch = mutableStruct({
  label: Schema.String,
  ref: Schema.String,
  sha: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{40}$/))),
  repo: Schema.optional(Schema.NullOr(forgeRepository)),
})
export const forgePull = mutableStruct({
  number: Schema.Number.pipe(Schema.check(Schema.isFinite()))
    .pipe(
      Schema.check(Schema.isInt()),
      Schema.check(
        Schema.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
      ),
    )
    .pipe(Schema.check(Schema.isGreaterThan(0))),
  title: Schema.String,
  html_url: link,
  state: Schema.Literals(['open', 'closed']),
  merged: Schema.Boolean.pipe(Schema.withDecodingDefaultType(Effect.sync(() => false))),
  draft: Schema.Boolean.pipe(Schema.withDecodingDefaultType(Effect.sync(() => false))),
  user: Schema.optional(Schema.NullOr(forgeUser)),
  updated_at: Schema.String,
  head: branch,
  base: branch,
  labels: Schema.optional(
    Schema.NullOr(
      mutableArray(
        mutableStruct({
          name: Schema.String,
        }),
      ),
    ),
  ),
  body: Schema.optional(Schema.NullOr(Schema.String)),
  additions: count,
  deletions: count,
  changed_files: count,
  mergeable: Schema.optional(Schema.NullOr(Schema.Boolean)),
  requested_reviewers: Schema.optional(Schema.NullOr(mutableArray(forgeUser))),
  requested_reviewers_teams: Schema.optional(
    Schema.NullOr(
      mutableArray(
        mutableStruct({
          name: Schema.String,
        }),
      ),
    ),
  ),
  assignees: Schema.optional(Schema.NullOr(mutableArray(forgeUser))),
  content_version: Schema.optional(
    Schema.Number.pipe(Schema.check(Schema.isFinite())).pipe(
      Schema.check(Schema.isInt()),
      Schema.check(
        Schema.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
      ),
    ),
  ),
})
export const forgeComment = mutableStruct({
  id: Schema.Number.pipe(Schema.check(Schema.isFinite()))
    .pipe(
      Schema.check(Schema.isInt()),
      Schema.check(
        Schema.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
      ),
    )
    .pipe(Schema.check(Schema.isGreaterThan(0))),
  user: Schema.optional(Schema.NullOr(forgeUser)),
  body: Schema.optional(Schema.NullOr(Schema.String)),
  html_url: link,
  created_at: Schema.String,
})
export const forgeReview = mutableStruct({
  id: Schema.Number.pipe(Schema.check(Schema.isFinite()))
    .pipe(
      Schema.check(Schema.isInt()),
      Schema.check(
        Schema.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
      ),
    )
    .pipe(Schema.check(Schema.isGreaterThan(0))),
  user: Schema.optional(Schema.NullOr(forgeUser)),
  body: Schema.optional(Schema.NullOr(Schema.String)),
  html_url: link,
  submitted_at: Schema.optional(Schema.NullOr(Schema.String)),
  updated_at: Schema.optional(Schema.NullOr(Schema.String)),
  state: Schema.String,
  dismissed: Schema.Boolean.pipe(Schema.withDecodingDefaultType(Effect.sync(() => false))),
  stale: Schema.Boolean.pipe(Schema.withDecodingDefaultType(Effect.sync(() => false))),
  official: Schema.Boolean.pipe(Schema.withDecodingDefaultType(Effect.sync(() => false))),
  comments_count: Schema.Number.pipe(Schema.check(Schema.isFinite()))
    .pipe(
      Schema.check(Schema.isInt()),
      Schema.check(
        Schema.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
      ),
    )
    .pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))
    .pipe(Schema.withDecodingDefaultType(Effect.sync(() => 0))),
})
export const forgeInline = mutableStruct({
  ...forgeComment.fields,
  ...{
    path: Schema.String,
    position: count,
    original_position: count,
    diff_hunk: Schema.optional(Schema.NullOr(Schema.String)),
    commit_id: Schema.optional(Schema.String),
    original_commit_id: Schema.optional(Schema.String),
    resolver: Schema.optional(Schema.NullOr(forgeUser)),
    pull_request_review_id: Schema.Number.pipe(Schema.check(Schema.isFinite())).pipe(
      Schema.check(Schema.isInt()),
      Schema.check(
        Schema.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
      ),
    ),
  },
})
export const forgeFile = mutableStruct({
  filename: Schema.String,
  previous_filename: Schema.optional(Schema.String),
  status: Schema.String,
  additions: count,
  deletions: count,
})
const forgeStatus = mutableStruct({
  context: Schema.String,
  status: Schema.String,
  target_url: Schema.optional(Schema.NullOr(Schema.Union([link, Schema.Literal('')]))),
})
export const forgeCombinedStatus = mutableStruct({
  state: Schema.String,
  statuses: mutableArray(forgeStatus),
  total_count: Schema.Number.pipe(Schema.check(Schema.isFinite()))
    .pipe(
      Schema.check(Schema.isInt()),
      Schema.check(
        Schema.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
      ),
    )
    .pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
})
