import { Effect } from 'effect'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useRef } from 'react'
import {
  startPolling,
  clientTaskScope,
  forgeWorkOptionsSchema,
  forgeIssuePageSchema,
  forgePipelinePageSchema,
  type ForgeWorkOptions,
  type ForgeIssue,
  type ForgePipeline,
} from '@dovo/studio-core'
import { useIssueSources, type WorkSource } from './work-sources'
type Page = {
  loadedPages?: number
  optionsMode?: 'issues' | 'pipelines'
  optionsFetchedAt?: number
  query?: string
  source: WorkSource
  items: Array<ForgeIssue | ForgePipeline>
  options?: ForgeWorkOptions
  next?: string
  stale?: boolean
  error?: string
}
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
const cacheKey = (source: WorkSource, mode: string, kind: string, query = '') =>
  JSON.stringify([
    'work',
    source.input,
    source.repository?.path,
    source.repository?.forge,
    source.jira,
    mode,
    kind,
    undefined,
    kind === 'list' ? 'all' : undefined,
    kind === 'list' ? query || undefined : undefined,
  ])
export function useWorkSources(mode: 'issues' | 'pipelines', search = '') {
  const sources = useIssueSources(mode === 'issues')
  const [stored, setStored, pagesRef] = useApplicationState<Record<string, Page>>({})
  const generation = useRef(0)
  const moreRef = useRef<(key: string) => Promise<void>>(async () => {})
  const lastMode = useRef(mode)
  const lastSearch = useRef(search)
  const [busy, setBusy] = useApplicationState(false)
  const [revision, setRevision] = useApplicationState(0)
  const forceNext = useRef(false)
  useEffect(() => {
    const current = ++generation.current
    const semaphore = Effect.runSync(Effect.makeSemaphore(1))
    const commands = clientTaskScope()
    const update = (source: WorkSource, page: Omit<Page, 'source'>) => {
      if (current === generation.current)
        setStored((previous) => ({ ...previous, [source.key]: { ...page, source } }))
    }
    setStored((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(
          ([key, page]) =>
            lastMode.current === mode &&
            lastSearch.current === search &&
            sources.some((source) => source.key === key && source.scope === page.source.scope),
        ),
      ),
    )
    lastMode.current = mode
    lastSearch.current = search
    const hydrated = Effect.runSync(
      Effect.cached(
        Effect.forEach(
          sources,
          (source) =>
            Effect.gen(function* () {
              if (pagesRef.current[source.key]) return
              const [options, page] = yield* Effect.all([
                source.readCache.readEffect(
                  cacheKey(source, mode, 'options'),
                  forgeWorkOptionsSchema,
                ),
                mode === 'issues'
                  ? source.readCache.readEffect(
                      cacheKey(source, mode, 'list', search),
                      forgeIssuePageSchema,
                    )
                  : source.readCache.readEffect(
                      cacheKey(source, mode, 'list', search),
                      forgePipelinePageSchema,
                    ),
              ])
              if (!pagesRef.current[source.key] && (options || page))
                update(source, {
                  ...page?.value,
                  items: page?.value.items ?? [],
                  options: options?.value,
                  optionsMode: mode,
                  // Disk entries have no in-memory fetch time and must refresh on the next poll.
                  stale: true,
                  query: options?.value.issueSearch ? search : undefined,
                })
            }).pipe(
              Effect.catchAll(() =>
                Effect.sync(() =>
                  update(source, {
                    items: [],
                    error: 'Saved results could not be read from this device.',
                  }),
                ),
              ),
            ),
          { concurrency: 3, discard: true },
        ),
      ),
    )
    setBusy(sources.some((source) => source.connected))
    let force = forceNext.current
    forceNext.current = false
    const load = Effect.gen(function* () {
      yield* hydrated
      if (document.visibilityState !== 'visible') return
      const refresh = force
      force = false
      setBusy(sources.some((source) => source.connected))
      yield* Effect.forEach(
        sources.filter((source) => source.connected),
        (source) =>
          Effect.gen(function* () {
            const previous = pagesRef.current[source.key]
            const options =
              reusableOptions(previous, source, mode, refresh) ??
              (yield* source.requestEffect(
                '/api/scm/work/options',
                {
                  ...source.input,
                  area: mode,
                },
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
            const count = refresh ? 1 : Math.max(1, pagesRef.current[source.key]?.loadedPages ?? 1)
            let response: {
              items: Array<ForgeIssue | ForgePipeline>
              next?: string
              stale?: boolean
              refreshError?: string
            } = {
              items: [],
            }
            let loadedPages = 0
            if (supported)
              for (let number = 0; number < count; number++) {
                const next =
                  mode === 'issues'
                    ? yield* source.requestEffect(
                        '/api/scm/work/issues/list',
                        {
                          ...source.input,
                          state: 'all',
                          query,
                          cursor: response.next,
                          refresh,
                        },
                        forgeIssuePageSchema,
                      )
                    : yield* source.requestEffect(
                        '/api/scm/work/pipelines/list',
                        {
                          ...source.input,
                          cursor: response.next,
                          refresh,
                        },
                        forgePipelinePageSchema,
                      )
                response = {
                  ...next,
                  stale: response.stale || next.stale,
                  refreshError: response.refreshError || next.refreshError,
                  items: [
                    ...new Map(
                      [...response.items, ...next.items].map((item) => [item.id, item]),
                    ).values(),
                  ],
                }
                loadedPages++
                if (!response.next) break
              }
            const page = {
              ...response,
              options,
              optionsMode: mode,
              optionsFetchedAt,
              loadedPages,
              query,
              error: response.refreshError,
            }
            update(source, page)
            yield* Effect.gen(function* () {
              yield* source.readCache.writeEffect(cacheKey(source, mode, 'options'), options)
              yield* source.readCache.writeEffect(cacheKey(source, mode, 'list', search), response)
            }).pipe(
              Effect.catchAll(() =>
                Effect.sync(() =>
                  update(source, {
                    ...page,
                    error: 'Results loaded, but could not be saved for offline use.',
                  }),
                ),
              ),
            )
          }).pipe(
            Effect.catchAll((error) =>
              Effect.sync(() =>
                update(source, {
                  ...(pagesRef.current[source.key] ?? { items: [] }),
                  stale: true,
                  error: error.message,
                }),
              ),
            ),
          ),
        { concurrency: 3, discard: true },
      )
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (current === generation.current) setBusy(false)
        }),
      ),
    )
    const polling = startPolling(semaphore.withPermits(1)(load), {
      interval: 30000,
      onError: () => {},
    })
    const more = (key: string) =>
      Effect.gen(function* () {
        const previous = pagesRef.current[key]
        const source = sources.find((source) => source.key === key)
        if (!previous?.next || !source?.connected) return
        setBusy(true)
        yield* Effect.gen(function* () {
          const response =
            mode === 'issues'
              ? yield* source.requestEffect(
                  '/api/scm/work/issues/list',
                  {
                    ...source.input,
                    state: 'all',
                    query: previous.query,
                    cursor: previous.next,
                  },
                  forgeIssuePageSchema,
                )
              : yield* source.requestEffect(
                  '/api/scm/work/pipelines/list',
                  {
                    ...source.input,
                    cursor: previous.next,
                  },
                  forgePipelinePageSchema,
                )
          if (current !== generation.current) return
          const items = [
            ...new Map([...previous.items, ...response.items].map((row) => [row.id, row])).values(),
          ]
          const page = {
            ...previous,
            ...response,
            next: response.next,
            stale: previous.stale || response.stale,
            items,
            loadedPages: (previous.loadedPages ?? 1) + 1,
            error: previous.error || response.refreshError,
          }
          update(source, page)
          yield* source.readCache
            .writeEffect(cacheKey(source, mode, 'list', search), {
              ...response,
              items,
              stale: page.stale,
              refreshError: page.error,
            })
            .pipe(
              Effect.catchAll(() =>
                Effect.sync(() =>
                  update(source, {
                    ...page,
                    error: 'Results loaded, but could not be saved for offline use.',
                  }),
                ),
              ),
            )
        }).pipe(
          Effect.catchAll((error) =>
            Effect.sync(() => update(source, { ...previous, error: error.message })),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              if (current === generation.current) setBusy(false)
            }),
          ),
        )
      })
    moreRef.current = (key) =>
      commands.run(semaphore.withPermitsIfAvailable(1)(more(key)).pipe(Effect.asVoid))
    document.addEventListener('visibilitychange', polling.refresh)
    return () => {
      generation.current++
      moreRef.current = async () => {}
      document.removeEventListener('visibilitychange', polling.refresh)
      void polling.stop()
      void commands.stop()
    }
  }, [sources, mode, revision, search])
  const refresh = () => {
    forceNext.current = true
    setRevision((value) => value + 1)
  }
  const pages = sources.flatMap((source) => {
    const page = stored[source.key]
    return page &&
      page.source.scope === source.scope &&
      lastMode.current === mode &&
      lastSearch.current === search
      ? [
          {
            ...page,
            source,
          },
        ]
      : []
  })
  return {
    sources,
    pages,
    busy,
    refresh,
    more: (key: string) => moreRef.current(key),
  }
}
