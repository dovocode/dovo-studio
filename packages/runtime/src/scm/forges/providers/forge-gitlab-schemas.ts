import { Schema } from 'effect'
import { mutableArray, mutableStruct } from '@dovo/protocol'

export const gitlabUser = mutableStruct({ id: Schema.Number, username: Schema.String })
export const gitlabProject = mutableStruct({
  id: Schema.Number,
  name: Schema.String,
  path_with_namespace: Schema.String,
  web_url: Schema.String,
  http_url_to_repo: Schema.String,
  default_branch: Schema.optional(Schema.NullOr(Schema.String)),
  squash_option: Schema.optional(Schema.String),
})
export const gitlabMergeRequest = mutableStruct({
  iid: Schema.Number,
  title: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  web_url: Schema.String,
  state: Schema.Literals(['opened', 'closed', 'merged', 'locked']),
  draft: Schema.optional(Schema.Boolean),
  work_in_progress: Schema.optional(Schema.Boolean),
  author: Schema.NullOr(gitlabUser),
  assignees: Schema.optional(mutableArray(gitlabUser)),
  reviewers: Schema.optional(mutableArray(gitlabUser)),
  labels: mutableArray(Schema.String),
  updated_at: Schema.String,
  source_branch: Schema.String,
  target_branch: Schema.String,
  sha: Schema.NullOr(Schema.String),
  source_project_id: Schema.NullOr(Schema.Number),
  diff_refs: Schema.optional(
    Schema.NullOr(
      mutableStruct({
        base_sha: Schema.String,
        start_sha: Schema.String,
        head_sha: Schema.String,
      }),
    ),
  ),
  detailed_merge_status: Schema.optional(Schema.String),
  head_pipeline: Schema.optional(
    Schema.NullOr(
      mutableStruct({
        id: Schema.Number,
        name: Schema.optional(Schema.NullOr(Schema.String)),
        status: Schema.String,
        web_url: Schema.String,
      }),
    ),
  ),
  user_notes_count: Schema.optional(Schema.Number),
})
export const gitlabNote = mutableStruct({
  id: Schema.Number,
  body: Schema.String,
  author: Schema.NullOr(gitlabUser),
  created_at: Schema.String,
  system: Schema.optional(Schema.Boolean),
})
export const gitlabDiff = mutableStruct({
  old_path: Schema.String,
  new_path: Schema.String,
  diff: Schema.String,
  new_file: Schema.Boolean,
  deleted_file: Schema.Boolean,
  renamed_file: Schema.Boolean,
  collapsed: Schema.optional(Schema.Boolean),
  too_large: Schema.optional(Schema.Boolean),
})
export const gitlabPipeline = mutableStruct({
  id: Schema.Number,
  iid: Schema.optional(Schema.Number),
  status: Schema.String,
  ref: Schema.String,
  sha: Schema.String,
  web_url: Schema.String,
  created_at: Schema.String,
  updated_at: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  source: Schema.optional(Schema.String),
  user: Schema.optional(Schema.NullOr(gitlabUser)),
  started_at: Schema.optional(Schema.NullOr(Schema.String)),
  finished_at: Schema.optional(Schema.NullOr(Schema.String)),
})
