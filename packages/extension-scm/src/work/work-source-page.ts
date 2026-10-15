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
import { verifySourceReader } from '../connections/source-readers'
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
  reader: WorkSource
  loadedPages?: number
  optionsMode?: 'issues' | 'pipelines'
  optionsFetchedAt?: number
  query?: string
  options?: ForgeWorkOptions
  error?: string
  optionsError?: string
}

export type WorkListSource = WorkSource & {
  reader: WorkSource & { readerIdentity?: string }
  destination?: string
}

/** Alternate computers provide reads, never the destination for actions or tasks. */
export function workPageForOrigin(page: WorkItemsPage, source: WorkListSource): WorkItemsPage {
  return source.reader.key === source.key
    ? page
    : {
        ...page,
        items: page.items.map((item) => ({ ...item, destination: source.destination })),
      }
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
        reader: { scope: string }
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
    page &&
    page.reader.scope === source.scope &&
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
  source: WorkListSource,
  mode: 'issues' | 'pipelines',
  search: string,
  state: string,
  refresh: boolean,
  previous?: WorkSourcePage,
  jiraFilters?: JiraIssueFilters,
  onPage?: (page: Omit<WorkSourcePage, 'source' | 'reader'>) => void,
) {
  return Effect.gen(function* () {
    const reader = source.reader
    const readGuard = yield* verifySourceReader(reader)
    const jira = mode === 'issues' && !!source.jira
    const readOptions = reader.requestEffect(
      '/api/scm/work/options',
      { ...reader.input, ...readGuard, area: mode },
      forgeWorkOptionsSchema,
    )
    let options = reusableOptions(previous, reader, mode, refresh)
    if (!jira && !options) options = yield* readOptions
    const query =
      mode === 'issues' &&
      (jira || options?.issueSearch) &&
      search &&
      !`${source.name} ${source.runtimeName}`.toLowerCase().includes(search.toLowerCase())
        ? search
        : undefined
    const supported = jira || (mode === 'issues' ? options?.issues : options?.pipelines)
    const count = Math.max(1, previous?.loadedPages ?? 1)
    let response: WorkItemsPage = { items: [] }
    let loadedPages = 0
    if (supported)
      for (let number = 0; number < count; number++) {
        const next =
          mode === 'issues'
            ? yield* reader.requestEffect(
                '/api/scm/work/issues/list',
                {
                  ...reader.input,
                  state,
                  ...readGuard,
                  query,
                  cursor: response.next,
                  refresh,
                  ...(source.jira && jiraFilters ? { jiraFilters } : {}),
                },
                forgeIssuePageSchema,
              )
            : yield* reader.requestEffect(
                '/api/scm/work/pipelines/list',
                { ...reader.input, ...readGuard, cursor: response.next, refresh },
                forgePipelinePageSchema,
              )
        response = appendWorkPage(response, workPageForOrigin(next, source))
        loadedPages++
        if (!response.next) break
      }
    const content = {
      ...response,
      loadedPages: Math.max(1, loadedPages),
      query,
      error: response.refreshError,
    }
    let optionsError: string | undefined
    if (jira && !options) {
      onPage?.(content)
      yield* readOptions.pipe(
        Effect.tap((value) =>
          Effect.sync(() => {
            options = value
          }),
        ),
        Effect.catch((error) =>
          Effect.sync(() => {
            optionsError = error.message
          }),
        ),
      )
    }
    return {
      ...content,
      options:
        options &&
        (reader.key === source.key ? options : { ...options, destination: source.destination }),
      optionsMode: mode,
      optionsFetchedAt: options
        ? options === previous?.options
          ? previous?.optionsFetchedAt
          : Date.now()
        : undefined,
      optionsError,
    }
  })
}
