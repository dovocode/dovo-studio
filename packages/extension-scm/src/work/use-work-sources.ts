import type { JiraIssueFilters } from '@dovo/protocol'
import { Effect, Semaphore } from 'effect'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useMemo, useRef } from 'react'
import {
  startPolling,
  clientTaskScope,
  forgeWorkOptionsSchema,
  forgeIssuePageSchema,
  forgePipelinePageSchema,
} from '@dovo/studio-core'
import { useIssueSources, type WorkSource } from './work-sources'
import {
  appendWorkPage,
  cachedWorkIssuePageSchema,
  cachedWorkPipelinePageSchema,
  loadWorkSourcePage,
  workPageCacheValue,
  workSourceCacheKey,
  type WorkSourcePage,
} from './work-source-page'

export function useWorkSources(
  mode: 'issues' | 'pipelines',
  search = '',
  sourceKind: 'issues' | 'jira' = 'issues',
  sourceKey = '',
  state = 'all',
  jiraFilters?: JiraIssueFilters,
) {
  const issueSources = useIssueSources(mode === 'issues')
  const sources = useMemo(
    () =>
      issueSources.filter((source) =>
        mode === 'pipelines' || sourceKind === 'issues' ? !source.jira : !!source.jira,
      ),
    [issueSources, mode, sourceKind],
  )
  const visibleSources = useMemo(
    () => sources.filter((source) => !sourceKey || source.key === sourceKey),
    [sources, sourceKey],
  )
  const [stored, setStored, pagesRef] = useApplicationState<Record<string, WorkSourcePage>>({})
  const generation = useRef(0)
  const moreRef = useRef<(key: string) => Promise<void>>(async () => {})
  const collection = JSON.stringify([mode, search, state, jiraFilters])
  const lastCollection = useRef(collection)
  const [busy, setBusy] = useApplicationState(false)
  const [revision, setRevision] = useApplicationState(0)
  const forceNext = useRef(false)
  useEffect(() => {
    const current = ++generation.current
    const semaphore = Effect.runSync(Semaphore.make(1))
    const commands = clientTaskScope()
    const update = (source: WorkSource, page: Omit<WorkSourcePage, 'source'>) => {
      if (current === generation.current)
        setStored((previous) => ({ ...previous, [source.key]: { ...page, source } }))
    }
    setStored((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(
          ([key, page]) =>
            lastCollection.current === collection &&
            sources.some((source) => source.key === key && source.scope === page.source.scope),
        ),
      ),
    )
    lastCollection.current = collection
    const hydrated = Effect.runSync(
      Effect.cached(
        Effect.forEach(
          visibleSources,
          (source) =>
            Effect.gen(function* () {
              if (pagesRef.current[source.key]) return
              const [options, page] = yield* Effect.all([
                source.readCache.readEffect(
                  workSourceCacheKey(source, mode, 'options'),
                  forgeWorkOptionsSchema,
                ),
                mode === 'issues'
                  ? source.readCache.readEffect(
                      workSourceCacheKey(source, mode, 'list', search, state, jiraFilters),
                      cachedWorkIssuePageSchema,
                    )
                  : source.readCache.readEffect(
                      workSourceCacheKey(source, mode, 'list', search, state, jiraFilters),
                      cachedWorkPipelinePageSchema,
                    ),
              ])
              if (!pagesRef.current[source.key] && (options || page))
                update(source, {
                  ...page?.value,
                  items: page?.value.items ?? [],
                  error: page?.value.refreshError,
                  options: options?.value,
                  optionsMode: mode,
                  // Disk entries have no in-memory fetch time and must refresh on the next poll.
                  stale: true,
                  query: options?.value.issueSearch ? search : undefined,
                })
            }).pipe(
              Effect.catch(() =>
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
    setBusy(visibleSources.some((source) => source.connected))
    let force = forceNext.current
    forceNext.current = false
    const load = Effect.gen(function* () {
      yield* hydrated
      if (document.visibilityState !== 'visible') return
      const refresh = force
      force = false
      setBusy(visibleSources.some((source) => source.connected))
      yield* Effect.forEach(
        visibleSources.filter((source) => source.connected),
        (source) =>
          Effect.gen(function* () {
            const previous = pagesRef.current[source.key]
            const page = yield* loadWorkSourcePage(
              source,
              mode,
              search,
              state,
              refresh,
              previous,
              jiraFilters,
            )
            update(source, page)
            yield* Effect.gen(function* () {
              yield* source.readCache.writeEffect(
                workSourceCacheKey(source, mode, 'options'),
                page.options,
              )
              yield* source.readCache.writeEffect(
                workSourceCacheKey(source, mode, 'list', search, state, jiraFilters),
                workPageCacheValue(page),
              )
            }).pipe(
              Effect.catch(() =>
                Effect.sync(() =>
                  update(source, {
                    ...page,
                    error: 'Results loaded, but could not be saved for offline use.',
                  }),
                ),
              ),
            )
          }).pipe(
            Effect.catch((error) =>
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
        const source = visibleSources.find((source) => source.key === key)
        if (!previous?.next || !source?.connected) return
        setBusy(true)
        yield* Effect.gen(function* () {
          const response =
            mode === 'issues'
              ? yield* source.requestEffect(
                  '/api/scm/work/issues/list',
                  {
                    ...source.input,
                    state,
                    ...(source.jira && jiraFilters ? { jiraFilters } : {}),
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
          const page = {
            ...previous,
            ...appendWorkPage(previous, response),
            loadedPages: (previous.loadedPages ?? 1) + 1,
            error: previous.error || response.refreshError,
          }
          update(source, page)
          yield* source.readCache
            .writeEffect(
              workSourceCacheKey(source, mode, 'list', search, state, jiraFilters),
              workPageCacheValue(page),
            )
            .pipe(
              Effect.catch(() =>
                Effect.sync(() =>
                  update(source, {
                    ...page,
                    error: 'Results loaded, but could not be saved for offline use.',
                  }),
                ),
              ),
            )
        }).pipe(
          Effect.catch((error) =>
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
  }, [sources, visibleSources, mode, revision, search, state, collection])
  const refresh = () => {
    forceNext.current = true
    setRevision((value) => value + 1)
  }
  const pages = visibleSources.flatMap((source) => {
    const page = stored[source.key]
    return page && page.source.scope === source.scope && lastCollection.current === collection
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
