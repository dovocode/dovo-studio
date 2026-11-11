import { mutableStruct, mutableArray } from '../../shared/schema.js'
import { urlSchema, refine, minValue, maxValue } from '../../shared/schema.js'
import { Schema, SchemaTransformation } from 'effect'
export const jiraBindingSchema = mutableStruct({
  site: refine(
    urlSchema({
      protocol: /^https$/,
    }),
    (value) => {
      try {
        const url = new URL(value)
        return (
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash &&
          !url.port &&
          url.pathname === '/' &&
          url.hostname.endsWith('.atlassian.net')
        )
      } catch {
        return false
      }
    },
    'Use your Jira Cloud site URL, for example https://team.atlassian.net',
  ),
  project: Schema.String.pipe(Schema.decodeTo(Schema.Trim))
    .pipe(
      Schema.decodeTo(
        Schema.String.check(Schema.isUppercased()),
        SchemaTransformation.toUpperCase(),
      ),
    )
    .pipe(Schema.check(Schema.isPattern(/^[A-Z][A-Z0-9_]{1,49}$/))),
})
export type JiraBinding = Schema.Schema.Type<typeof jiraBindingSchema>
const jiraFilterValue = refine(
  maxValue(minValue(Schema.String.pipe(Schema.decodeTo(Schema.Trim)), 1), 100),
  (value) => !/[\p{Cc}]/u.test(value),
)
export const jiraNumericId = Schema.String.pipe(Schema.check(Schema.isPattern(/^[1-9]\d{0,14}$/)))
export const jiraStatusCategorySchema = Schema.Literals(['todo', 'in-progress', 'done'])
export const jiraIssueFiltersSchema = mutableStruct({
  assignee: Schema.optional(Schema.Literals(['all', 'mine', 'unassigned'])),
  priority: Schema.optional(jiraFilterValue),
  type: Schema.optional(jiraFilterValue),
  label: Schema.optional(jiraFilterValue),
  statusCategory: Schema.optional(jiraStatusCategorySchema),
  orderBy: Schema.optional(Schema.Literals(['rank', 'updated', 'title'])),
  board: Schema.optional(jiraNumericId),
  sprint: Schema.optional(
    Schema.Union([jiraNumericId, Schema.Literals(['active', 'future', 'none'])]),
  ),
  team: Schema.optional(jiraFilterValue),
  component: Schema.optional(jiraFilterValue),
  release: Schema.optional(jiraFilterValue),
})
export type JiraIssueFilters = Schema.Schema.Type<typeof jiraIssueFiltersSchema>
/** Canonical identity: only assignee uses "all" as an unfiltered sentinel. */
export function jiraIssueFilterKey(filters?: JiraIssueFilters) {
  return [
    filters?.assignee === 'all' ? undefined : filters?.assignee,
    filters?.priority,
    filters?.type,
    filters?.label,
    filters?.statusCategory,
    ...([filters?.board, filters?.sprint, filters?.team, filters?.component, filters?.release].some(
      (value) => value !== undefined,
    )
      ? [filters?.board, filters?.sprint, filters?.team, filters?.component, filters?.release]
      : []),
    ...(filters?.orderBy ? [filters.orderBy] : []),
  ]
}
/** Board cards follow Jira Rank; list views keep the newest issues first. */
export function jiraIssueOrder(layout: 'list' | 'board', sort: string) {
  if (sort === 'title') return 'title' as const
  if (sort === 'recent') return 'updated' as const
  if (sort === 'rank' || layout === 'board') return 'rank' as const
  return 'updated' as const
}

/** The CLI exposes status categories, but not custom board column positions. */
export function jiraWorkflowStatuses(
  issues: ReadonlyArray<{ state: string; statusCategory?: typeof jiraStatusCategorySchema.Type }>,
) {
  const order = { todo: 0, 'in-progress': 1, done: 2 }
  const statuses = new Map<string, number>()
  for (const issue of issues) {
    const rank = issue.statusCategory ? order[issue.statusCategory] : 3
    statuses.set(issue.state, Math.min(statuses.get(issue.state) ?? 3, rank))
  }
  return [...statuses]
    .sort(([a, rankA], [b, rankB]) => rankA - rankB || a.localeCompare(b))
    .map(([state]) => state)
}
export function hasJiraIssueFilters(filters?: JiraIssueFilters) {
  return jiraIssueFilterKey(filters).some((value) => value !== undefined)
}
const browseCache = {
  destination: Schema.optional(Schema.String),
  cachedAt: Schema.optional(Schema.String),
  stale: Schema.optional(Schema.Boolean),
  refreshError: Schema.optional(Schema.String),
  truncated: Schema.Boolean,
}
export const jiraBoardsSchema = mutableStruct({
  ...browseCache,
  boards: mutableArray(
    mutableStruct({
      id: jiraNumericId,
      name: Schema.String,
      type: Schema.Literals(['scrum', 'kanban', 'simple']),
    }),
  ),
})
export const jiraSprintsSchema = mutableStruct({
  ...browseCache,
  board: jiraNumericId,
  sprints: mutableArray(
    mutableStruct({
      id: jiraNumericId,
      name: Schema.String,
      state: Schema.Literals(['active', 'future', 'closed']),
      startDate: Schema.optional(Schema.String),
      endDate: Schema.optional(Schema.String),
      goal: Schema.optional(Schema.String),
    }),
  ),
})
export type JiraBoards = typeof jiraBoardsSchema.Type
export type JiraSprints = typeof jiraSprintsSchema.Type
export const jiraProjectsSchema = mutableStruct({
  site: jiraBindingSchema.fields.site,
  projects: mutableArray(
    mutableStruct({
      key: jiraBindingSchema.fields.project,
      name: Schema.String,
    }),
  ),
  truncated: Schema.Boolean,
})
export type JiraProjects = Schema.Schema.Type<typeof jiraProjectsSchema>

/** A Jira namespace is an independent issue source, not a Dovo code project. */
export const jiraSourceSchema = mutableStruct({
  ...jiraBindingSchema.fields,
  ...{
    id: maxValue(minValue(Schema.String, 1), 200),
    name: Schema.optional(
      maxValue(minValue(Schema.String.pipe(Schema.decodeTo(Schema.Trim)), 1), 200),
    ),
  },
})
export type JiraSource = Schema.Schema.Type<typeof jiraSourceSchema>
export const jiraIssueLinkSchema = mutableStruct({
  sourceId: jiraSourceSchema.fields.id,
  issueId: maxValue(minValue(Schema.String, 1), 300),
  repositoryId: maxValue(minValue(Schema.String, 1), 200),
})
export type JiraIssueLink = Schema.Schema.Type<typeof jiraIssueLinkSchema>
