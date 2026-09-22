import { z } from 'zod'

const link = z.url({ protocol: /^https?$/ })
const count = z.number().int().nonnegative().nullish()
export const forgeUser = z.object({ login: z.string() })
export const forgeRepository = z.object({
  id: z.number().int(),
  name: z.string(),
  full_name: z.string(),
  html_url: link,
  clone_url: link,
  default_branch: z.string().optional(),
  allow_merge_commits: z.boolean().optional(),
  allow_squash_merge: z.boolean().optional(),
  allow_rebase: z.boolean().optional(),
})
const branch = z.object({
  label: z.string(),
  ref: z.string(),
  sha: z.string().regex(/^[a-f0-9]{40}$/),
  repo: forgeRepository.nullish(),
})
export const forgePull = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  html_url: link,
  state: z.enum(['open', 'closed']),
  merged: z.boolean().default(false),
  draft: z.boolean().default(false),
  user: forgeUser.nullish(),
  updated_at: z.string(),
  head: branch,
  base: branch,
  labels: z.array(z.object({ name: z.string() })).nullish(),
  body: z.string().nullish(),
  additions: count,
  deletions: count,
  changed_files: count,
  mergeable: z.boolean().nullish(),
  requested_reviewers: z.array(forgeUser).nullish(),
  requested_reviewers_teams: z.array(z.object({ name: z.string() })).nullish(),
  assignees: z.array(forgeUser).nullish(),
  content_version: z.number().int().optional(),
})
export const forgeComment = z.object({
  id: z.number().int().positive(),
  user: forgeUser.nullish(),
  body: z.string().nullish(),
  html_url: link,
  created_at: z.string(),
})
export const forgeReview = z.object({
  id: z.number().int().positive(),
  user: forgeUser.nullish(),
  body: z.string().nullish(),
  html_url: link,
  submitted_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  state: z.string(),
  dismissed: z.boolean().default(false),
  stale: z.boolean().default(false),
  official: z.boolean().default(false),
  comments_count: z.number().int().nonnegative().default(0),
})
export const forgeInline = forgeComment.extend({
  path: z.string(),
  position: count,
  original_position: count,
  diff_hunk: z.string().nullish(),
  commit_id: z.string().optional(),
  original_commit_id: z.string().optional(),
  resolver: forgeUser.nullish(),
  pull_request_review_id: z.number().int(),
})
export const forgeFile = z.object({
  filename: z.string(),
  previous_filename: z.string().optional(),
  status: z.string(),
  additions: count,
  deletions: count,
})
const forgeStatus = z.object({
  context: z.string(),
  status: z.string(),
  target_url: z.union([link, z.literal('')]).nullish(),
})
export const forgeCombinedStatus = z.object({
  state: z.string(),
  statuses: z.array(forgeStatus),
  total_count: z.number().int().nonnegative(),
})
