import { mutableStruct, mutableArray } from '@dovo/protocol'
import { Schema } from 'effect'
const user = Schema.NullOr(
  mutableStruct({
    login: Schema.String,
    avatar_url: Schema.optional(Schema.NullOr(Schema.String)),
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
  stack: Schema.optional(
    Schema.NullOr(
      mutableStruct({
        base: mutableStruct({ ref: Schema.String, sha: Schema.String }),
        id: Schema.optional(
          Schema.Number.pipe(Schema.check(Schema.isInt()), Schema.check(Schema.isGreaterThan(0))),
        ),
        number: Schema.optional(
          Schema.Number.pipe(Schema.check(Schema.isInt()), Schema.check(Schema.isGreaterThan(0))),
        ),
        position: Schema.optional(
          Schema.Number.pipe(Schema.check(Schema.isInt()), Schema.check(Schema.isGreaterThan(0))),
        ),
        size: Schema.optional(
          Schema.Number.pipe(Schema.check(Schema.isInt()), Schema.check(Schema.isGreaterThan(0))),
        ),
      }),
    ),
  ),
  requested_reviewers: Schema.optional(mutableArray(mutableStruct({ login: Schema.String }))),
  requested_teams: Schema.optional(mutableArray(mutableStruct({ slug: Schema.String }))),
  assignees: Schema.optional(mutableArray(mutableStruct({ login: Schema.String }))),
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
      repo: Schema.optional(Schema.NullOr(mutableStruct({ clone_url: Schema.String }))),
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
    authorAvatarUrl: p.user?.avatar_url || undefined,
    stack:
      p.stack?.id && p.stack.position && p.stack.size && p.stack.position <= p.stack.size
        ? {
            nativeId: p.stack.id,
            nativeNumber: p.stack.number,
            position: p.stack.position,
            size: p.stack.size,
            baseRef: p.stack.base.ref,
            complete: false,
            rootNumber: p.stack.position === 1 ? p.number : undefined,
          }
        : undefined,
    updatedAt: p.updated_at,
    head: p.head.label,
    base: p.base.label,
    labels: p.labels.map((l) => l.name),
  }
}

/** Native stack details are ordered bottom-to-top by GitHub. */
export const restStack = mutableStruct({
  id: Schema.Number.pipe(Schema.check(Schema.isInt()), Schema.check(Schema.isGreaterThan(0))),
  number: Schema.Number.pipe(Schema.check(Schema.isInt()), Schema.check(Schema.isGreaterThan(0))),
  base: mutableStruct({ ref: Schema.String }),
  pull_requests: mutableArray(
    mutableStruct({
      number: Schema.Number.pipe(
        Schema.check(Schema.isInt()),
        Schema.check(Schema.isGreaterThan(0)),
      ),
      title: Schema.String,
      html_url: Schema.String,
      draft: Schema.Boolean,
      head: mutableStruct({ ref: Schema.String }),
      base: mutableStruct({ ref: Schema.String }),
    }),
  ),
})
