import { mutableStruct, mutableArray } from '@dovo/protocol'
import { Schema } from 'effect'
const user = Schema.NullOr(
  mutableStruct({
    login: Schema.String,
  }),
)
export const restPull = mutableStruct({
  number: Schema.Number.pipe(Schema.check(Schema.isFinite())),
  title: Schema.String,
  html_url: Schema.String,
  state: Schema.Literals(['open', 'closed']),
  merged_at: Schema.NullOr(Schema.String),
  draft: Schema.optional(Schema.Boolean),
  user,
  updated_at: Schema.String,
  head: mutableStruct({
    label: Schema.String,
  }),
  base: mutableStruct({
    label: Schema.String,
  }),
  labels: mutableArray(
    mutableStruct({
      name: Schema.String,
    }),
  ),
})
export const restDetail = mutableStruct({
  ...restPull.fields,
  ...{
    head: mutableStruct({
      label: Schema.String,
      sha: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{40}$/))),
    }),
    base: mutableStruct({
      label: Schema.String,
      sha: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{40}$/))),
    }),
    body: Schema.NullOr(Schema.String),
    additions: Schema.Number.pipe(Schema.check(Schema.isFinite())),
    deletions: Schema.Number.pipe(Schema.check(Schema.isFinite())),
    changed_files: Schema.Number.pipe(Schema.check(Schema.isFinite())),
    mergeable: Schema.NullOr(Schema.Boolean),
    requested_teams: Schema.optional(
      mutableArray(
        mutableStruct({
          slug: Schema.String,
        }),
      ),
    ),
    requested_reviewers: mutableArray(
      mutableStruct({
        login: Schema.String,
      }),
    ),
    assignees: mutableArray(
      mutableStruct({
        login: Schema.String,
      }),
    ),
  },
})
export const restComment = mutableStruct({
  id: Schema.Number.pipe(Schema.check(Schema.isFinite())),
  user,
  body: Schema.NullOr(Schema.String),
  html_url: Schema.String,
  created_at: Schema.String,
})
export const restReview = mutableStruct({
  id: Schema.Number.pipe(Schema.check(Schema.isFinite())),
  user,
  body: Schema.NullOr(Schema.String),
  html_url: Schema.String,
  submitted_at: Schema.optional(Schema.NullOr(Schema.String)),
  state: Schema.String,
})
export const restInline = mutableStruct({
  ...restComment.fields,
  ...{
    path: Schema.String,
    line: Schema.NullOr(Schema.Number.pipe(Schema.check(Schema.isFinite()))),
    original_line: Schema.NullOr(Schema.Number.pipe(Schema.check(Schema.isFinite()))),
    diff_hunk: Schema.String,
    in_reply_to_id: Schema.optional(Schema.Number.pipe(Schema.check(Schema.isFinite()))),
  },
})
export const restFile = mutableStruct({
  filename: Schema.String,
  previous_filename: Schema.optional(Schema.String),
  status: Schema.String,
  additions: Schema.Number.pipe(Schema.check(Schema.isFinite())),
  deletions: Schema.Number.pipe(Schema.check(Schema.isFinite())),
  patch: Schema.optional(Schema.String),
})
export const checkRollup = mutableStruct({
  statusCheckRollup: Schema.NullOr(
    mutableArray(
      mutableStruct({
        name: Schema.optional(Schema.String),
        context: Schema.optional(Schema.String),
        status: Schema.optional(Schema.String),
        conclusion: Schema.optional(Schema.NullOr(Schema.String)),
        state: Schema.optional(Schema.String),
        detailsUrl: Schema.optional(Schema.NullOr(Schema.String)),
        targetUrl: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
})
export function summary(p: Schema.Schema.Type<typeof restPull>) {
  return {
    number: p.number,
    title: p.title,
    url: p.html_url,
    state: p.merged_at ? ('merged' as const) : p.state,
    draft: p.draft ?? false,
    author: p.user?.login ?? 'Deleted user',
    updatedAt: p.updated_at,
    head: p.head.label,
    base: p.base.label,
    labels: p.labels.map((l) => l.name),
  }
}
