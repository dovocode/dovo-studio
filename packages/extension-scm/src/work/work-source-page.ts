import { Effect, Schema } from 'effect'
import {
  forgeIssuePageSchema,
  forgePipelinePageSchema,
  forgeWorkOptionsSchema,
  mutableStruct,
  jiraIssueFilterKey,
  hasJiraIssueFilters,
  type JiraIssueFilters,
  type ForgeIssue,
  type ForgePipeline,
  type ForgeWorkOptions,
} from '@dovo/protocol'
import type { WorkSource } from './work-sources'

export type WorkItemsPage = {
  items: Array<ForgeIssue | ForgePipeline>
  next?: string
  cachedAt?: string
  stale?: boolean
  refreshError?: string
}
export type WorkSourcePage = WorkItemsPage & {
  source: WorkSource
  loadedPages?: number
  optionsMode?: 'issues' | 'pipelines'
  optionsFetchedAt?: number
  query?: string
  options?: ForgeWorkOptions
  error?: string
}

const loadedPages = Schema.optional(
  Schema.Number.pipe(
    Schema.check(Schema.isInt()),
    Schema.check(Schema.isBetween({ minimum: 1, maximum: 500 })),
  ),
)
export const cachedWorkIssuePageSchema = mutableStruct({
  ...forgeIssuePageSchema.fields,
  loadedPages,
})
export const cachedWorkPipelinePageSchema = mutableStruct({
  ...forgePipelinePageSchema.fields,
  loadedPages,
})

/** Keep runtime connections, request functions and in-memory options out of saved pages. */
export const workPageCacheValue = (page: WorkItemsPage & { loadedPages?: number }) => ({
  items: page.items,
  next: page.next,
  cachedAt: page.cachedAt,
  stale: page.stale,
  refreshError: page.refreshError,
  loadedPages: page.loadedPages,
})

export const workSourceCacheKey = (
  source: WorkSource,
  mode: string,
  kind: 'list' | 'options',
  query = '',
  state = 'all',
  jiraFilters?: JiraIssueFilters,
) =>
  JSON.stringify([
    'work',
    source.input,
    source.repository?.path,
    source.repository?.forge,
    source.jira,
    mode,
    kind,
    undefined,
    kind === 'list' ? state : undefined,
    kind === 'list' ? query || undefined : undefined,
    ...(kind === 'list' && source.jira && hasJiraIssueFilters(jiraFilters)
      ? [jiraIssueFilterKey(jiraFilters)]
      : []),
  ])

export function reusableOptions<T>(
  page:
    | {
        source: { scope: string }
        optionsMode?: string
        optionsFetchedAt?: number
        options?: T
      }
    | undefined,
  source: { scope: string },
  mode: string,
  refresh: boolean,
  now = Date.now(),
): T | undefined {
  return !refresh &&
    page?.source.scope === source.scope &&
    page.optionsMode === mode &&
    page.optionsFetchedAt !== undefined &&
    now - page.optionsFetchedAt >= 0 &&
    now - page.optionsFetchedAt < 60_000
    ? page.options
    : undefined
}

export function appendWorkPage(previous: WorkItemsPage, incoming: WorkItemsPage): WorkItemsPage {
  return {
    ...incoming,
    // Freshness covers every loaded page, not just the latest request.
    cachedAt:
      previous.cachedAt && incoming.cachedAt
        ? previous.cachedAt < incoming.cachedAt
          ? previous.cachedAt
          : incoming.cachedAt
        : (previous.cachedAt ?? incoming.cachedAt),
    stale: previous.stale || incoming.stale,
    refreshError: previous.refreshError || incoming.refreshError,
    items: [
      ...new Map([...previous.items, ...incoming.items].map((item) => [item.id, item])).values(),
    ],
  }
}

/** Re-read the loaded depth, including an explicit refresh, with filters applied before paging. */
export function loadWorkSourcePage(
  source: WorkSource,
  mode: 'issues' | 'pipelines',
  search: string,
  state: string,
  refresh: boolean,
  previous?: WorkSourcePage,
  jiraFilters?: JiraIssueFilters,
) {
  return Effect.gen(function* () {
    const options =
      reusableOptions(previous, source, mode, refresh) ??
      (yield* source.requestEffect(
        '/api/scm/work/options',
        { ...source.input, area: mode },
        forgeWorkOptionsSchema,
      ))
    const optionsFetchedAt =
      options === previous?.options && previous?.optionsFetchedAt !== undefined
        ? previous.optionsFetchedAt
        : Date.now()
    const query =
      mode === 'issues' &&
      options.issueSearch &&
      search &&
      !`${source.name} ${source.runtimeName}`.toLowerCase().includes(search.toLowerCase())
        ? search
        : undefined
    const supported = mode === 'issues' ? options.issues : options.pipelines
    const count = Math.max(1, previous?.loadedPages ?? 1)
    let response: WorkItemsPage = { items: [] }
    let loadedPages = 0
    if (supported)
      for (let number = 0; number < count; number++) {
        const next =
          mode === 'issues'
            ? yield* source.requestEffect(
                '/api/scm/work/issues/list',
                {
                  ...source.input,
                  state,
                  query,
                  cursor: response.next,
                  refresh,
                  ...(source.jira && jiraFilters ? { jiraFilters } : {}),
                },
                forgeIssuePageSchema,
              )
            : yield* source.requestEffect(
                '/api/scm/work/pipelines/list',
                { ...source.input, cursor: response.next, refresh },
                forgePipelinePageSchema,
              )
        response = appendWorkPage(response, next)
        loadedPages++
        if (!response.next) break
      }
    return {
      ...response,
      options,
      optionsMode: mode,
      optionsFetchedAt,
      loadedPages: Math.max(1, loadedPages),
      query,
      error: response.refreshError,
    }
  })
}
