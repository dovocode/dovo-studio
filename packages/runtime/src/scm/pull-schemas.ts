import { z } from 'zod'
const user = z.object({ login: z.string() }).nullable()
export const restPull = z.object({
  number: z.number(),
  title: z.string(),
  html_url: z.string(),
  state: z.enum(['open', 'closed']),
  merged_at: z.string().nullable(),
  draft: z.boolean().optional(),
  user,
  updated_at: z.string(),
  head: z.object({ label: z.string() }),
  base: z.object({ label: z.string() }),
  labels: z.array(z.object({ name: z.string() })),
})
export const restDetail = restPull.extend({
  head: z.object({ label: z.string(), sha: z.string().regex(/^[a-f0-9]{40}$/) }),
  base: z.object({ label: z.string(), sha: z.string().regex(/^[a-f0-9]{40}$/) }),
  body: z.string().nullable(),
  additions: z.number(),
  deletions: z.number(),
  changed_files: z.number(),
  mergeable: z.boolean().nullable(),
  requested_teams: z.array(z.object({ slug: z.string() })).optional(),
  requested_reviewers: z.array(z.object({ login: z.string() })),
  assignees: z.array(z.object({ login: z.string() })),
})
export const restComment = z.object({
  id: z.number(),
  user,
  body: z.string().nullable(),
  html_url: z.string(),
  created_at: z.string(),
})
export const restReview = z.object({
  id: z.number(),
  user,
  body: z.string().nullable(),
  html_url: z.string(),
  submitted_at: z.string().nullish(),
  state: z.string(),
})
export const restInline = restComment.extend({
  path: z.string(),
  line: z.number().nullable(),
  original_line: z.number().nullable(),
  diff_hunk: z.string(),
  in_reply_to_id: z.number().optional(),
})
export const restFile = z.object({
  filename: z.string(),
  previous_filename: z.string().optional(),
  status: z.string(),
  additions: z.number(),
  deletions: z.number(),
  patch: z.string().optional(),
})
export const checkRollup = z.object({
  statusCheckRollup: z
    .array(
      z.object({
        name: z.string().optional(),
        context: z.string().optional(),
        status: z.string().optional(),
        conclusion: z.string().nullable().optional(),
        state: z.string().optional(),
        detailsUrl: z.string().nullish(),
        targetUrl: z.string().nullish(),
      }),
    )
    .nullable(),
})
export function summary(p: z.infer<typeof restPull>) {
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
