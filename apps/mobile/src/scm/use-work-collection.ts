import { Effect } from 'effect'
import { clientTaskScope, startPolling } from '@dovo/client-runtime'
import { useApplicationState } from '../runtime/application-state'
import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import {
  forgeWorkOptionsSchema,
  forgeIssuePageSchema,
  forgePipelinePageSchema,
  type ForgeIssue,
  type ForgePipeline,
  type ForgeWorkOptions,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import {
  workSources,
  workSourceIdentity,
  workSourceContentIdentity,
  workSourceInput,
  type WorkSource,
  retainWorkPages,
} from './work-sources'
import { useNavigation } from '../shell/navigation'
import { workCacheKey } from './work-cache'
import { refreshFirstPage, shouldSweepWorkPages } from './collection-pages'
export type WorkPage = {
  source: WorkSource
  options?: ForgeWorkOptions
  items: Array<ForgeIssue | ForgePipeline>
  next?: string
  stale: boolean
  searched?: boolean
  error?: string
  firstPageIds?: string[]
  paginated?: boolean
  loadedPages?: number
}
export function useWorkCollection(
  mode: 'issues' | 'pipelines',
  repositoryKey: string,
  state: string,
  query = '',
) {
  const { overviews, readRuntimeEffect: readRuntime, cacheForRuntime } = useRuntime()
  const { focused } = useNavigation()
  const sources = workSources(overviews, mode).filter(
    (entry) => !repositoryKey || entry.key === repositoryKey,
  )
  const identity = workSourceIdentity(sources)
  const sourcesRef = useRef(sources)
  sourcesRef.current = sources
  const [pages, setPages, pageRef] = useApplicationState<Record<string, WorkPage>>({})
  const generation = useRef(0)
  const moreRef = useRef<(key: string) => Promise<void>>(async () => {})
  const forceNext = useRef(false)
  const fullSweepAt = useRef(new Map<string, number>())
  const [busy, setBusy] = useApplicationState(false)
  const [revision, setRevision] = useApplicationState(0)
  const lastQuery = useRef('')
  const update = (key: string, page: WorkPage) =>
    setPages((previous) => ({ ...previous, [key]: page }))
  const load = (
    source: WorkSource,
    current: number,
    cursor?: string,
    force = false,
    hydrate = false,
    base?: WorkPage,
    publish = true,
    knownOptions?: ForgeWorkOptions,
  ) =>
    Effect.gen(function* () {
      const cache = cacheForRuntime(source.profile)
      const optionsKey = workCacheKey(
        source.kind === 'jira' ? source.jiraSource : source.repository,
        mode,
        'options',
      )
      const pageKey = workCacheKey(
        source.kind === 'jira' ? source.jiraSource : source.repository,
        mode,
        'list',
        {
          state,
          cursor,
          query,
        },
      )
      let page: WorkPage = base ??
        pageRef.current[source.key] ?? {
          source,
          items: [],
          stale: true,
        }
      yield* Effect.gen(function* () {
        if (hydrate && !cursor) {
          const [options, cached] = yield* Effect.all([
            cache.readEffect(optionsKey, forgeWorkOptionsSchema),
            mode === 'issues'
              ? cache.readEffect(pageKey, forgeIssuePageSchema)
              : cache.readEffect(pageKey, forgePipelinePageSchema),
          ])
          // Offline searches can still filter the saved first page when this query has
          // never been requested before; distinguish it from server-filtered results.
          const saved =
            cached ??
            (mode === 'issues' && query
              ? yield* cache.readEffect(
                  workCacheKey(
                    source.kind === 'jira' ? source.jiraSource : source.repository,
                    mode,
                    'list',
                    {
                      state,
                    },
                  ),
                  forgeIssuePageSchema,
                )
              : undefined)
          if (generation.current !== current) return
          page = {
            ...page,
            source,
            options: options?.value ?? page.options,
            items: page.items.length ? page.items : (saved?.value.items ?? []),
            next: page.items.length ? page.next : saved?.value.next,
            searched: page.items.length
              ? page.searched
              : !!cached && !!query && !!options?.value.issueSearch,
            stale: page.items.length ? page.stale : true,
            error: undefined,
          }
          if (publish) update(source.key, page)
        }
      }).pipe(
        Effect.catchAll(() =>
          Effect.sync(() => {
            page = {
              ...page,
              error: 'Saved work could not be read from this device.',
            }
            if (publish && generation.current === current) update(source.key, page)
          }),
        ),
      )
      if (
        !source.connected ||
        generation.current !== current ||
        !focused ||
        AppState.currentState !== 'active'
      )
        return
      return yield* Effect.gen(function* () {
        const options =
          knownOptions ??
          (yield* readRuntime(
            source.profile,
            '/api/scm/work/options',
            {
              ...workSourceInput(source),
              area: mode,
            },
            forgeWorkOptionsSchema,
          ))
        if (generation.current !== current) return
        if (!(mode === 'issues' ? options.issues : options.pipelines)) {
          const empty: WorkPage = {
            source,
            options,
            items: [],
            stale: false,
          }
          if (publish) update(source.key, empty)
          yield* cache.writeEffect(optionsKey, options)
          return empty
        }
        const sourceState =
          state === 'all'
            ? 'all'
            : options.provider === 'jira'
              ? state
              : options.issueStates.find((value) => value.toLowerCase() === state.toLowerCase())
        if (mode === 'issues' && !sourceState) {
          const empty: WorkPage = {
            source,
            options,
            items: [],
            stale: false,
          }
          if (publish) update(source.key, empty)
          return empty
        }
        const data =
          mode === 'issues'
            ? yield* readRuntime(
                source.profile,
                '/api/scm/work/issues/list',
                {
                  ...workSourceInput(source),
                  state: sourceState,
                  ...(options.issueSearch && query
                    ? {
                        query,
                      }
                    : {}),
                  cursor,
                  refresh: force,
                },
                forgeIssuePageSchema,
              )
            : yield* readRuntime(
                source.profile,
                '/api/scm/work/pipelines/list',
                {
                  ...workSourceInput(source),
                  cursor,
                  refresh: force,
                },
                forgePipelinePageSchema,
              )
        if (generation.current !== current) return
        const retaining = !cursor && !force && page.paginated && page.firstPageIds && data.next
        const next: WorkPage = {
          source,
          options,
          items: cursor
            ? [...new Map([...page.items, ...data.items].map((item) => [item.id, item])).values()]
            : retaining
              ? refreshFirstPage(page.items, page.firstPageIds ?? [], data.items, (item) => item.id)
              : data.items,
          searched: mode === 'issues' && !!query && !!options.issueSearch,
          firstPageIds: cursor ? page.firstPageIds : data.items.map((item) => item.id),
          paginated: !!cursor || !!retaining,
          loadedPages: cursor
            ? (page.loadedPages ?? 1) + 1
            : retaining
              ? (page.loadedPages ?? 2)
              : 1,
          next: retaining ? page.next : data.next,
          stale: !!data.stale || !!data.refreshError || !!retaining || (!!cursor && page.stale),
          error: data.refreshError || (cursor ? page.error : undefined),
        }
        if (publish) update(source.key, next)
        let cacheError = false
        yield* Effect.all(
          [cache.writeEffect(optionsKey, options), cache.writeEffect(pageKey, data)],
          { concurrency: 2 },
        ).pipe(
          Effect.catchAll(() =>
            Effect.sync(() => {
              cacheError = true
              if (publish && generation.current === current)
                update(source.key, {
                  ...next,
                  error: 'Work loaded, but could not be saved for offline use.',
                })
            }),
          ),
        )
        return cacheError
          ? { ...next, error: 'Work loaded, but could not be saved for offline use.' }
          : next
      }).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            const failed = { ...page, source, stale: true, error: error.message }
            if (publish && generation.current === current) update(source.key, failed)
            return failed
          }),
        ),
      )
    })
  const loadRef = useRef(load)
  loadRef.current = load
  useEffect(() => {
    const current = ++generation.current
    const queryKey = JSON.stringify([state, mode, query])
    const sweepKeys = new Set(
      sourcesRef.current.map((source) =>
        JSON.stringify([workSourceContentIdentity(source), mode, state, query]),
      ),
    )
    for (const key of fullSweepAt.current.keys())
      if (!sweepKeys.has(key)) fullSweepAt.current.delete(key)
    setPages(
      lastQuery.current !== queryKey
        ? {}
        : Object.fromEntries(
            retainWorkPages(Object.values(pageRef.current), sourcesRef.current).map((page) => [
              page.source.key,
              page,
            ]),
          ),
    )
    lastQuery.current = queryKey
    let force = forceNext.current
    forceNext.current = false
    const commands = clientTaskScope()
    const semaphore = Effect.runSync(Effect.makeSemaphore(1))
    let hydrate = true
    const done = Effect.sync(() => {
      if (generation.current === current) setBusy(false)
    })
    const poll = Effect.gen(function* () {
      const shouldHydrate = hydrate
      hydrate = false
      if (!shouldHydrate && (!focused || AppState.currentState !== 'active')) return
      const refresh = force && focused && AppState.currentState === 'active'
      if (refresh) force = false
      const connected = sourcesRef.current.some((source) => source.connected)
      const hasPage = sourcesRef.current.some((source) => !!pageRef.current[source.key])
      setBusy(focused && AppState.currentState === 'active' && connected && (refresh || !hasPage))
      yield* Effect.forEach(
        sourcesRef.current,
        (source) =>
          Effect.gen(function* () {
            const sweepKey = JSON.stringify([workSourceContentIdentity(source), mode, state, query])
            const lastSweep = fullSweepAt.current.get(sweepKey) ?? Date.now()
            if (!fullSweepAt.current.has(sweepKey)) fullSweepAt.current.set(sweepKey, lastSweep)
            const previous = pageRef.current[source.key]
            if (
              refresh ||
              !source.connected ||
              !focused ||
              AppState.currentState !== 'active' ||
              !shouldSweepWorkPages(previous?.loadedPages, lastSweep, Date.now())
            ) {
              yield* loadRef.current(source, current, undefined, refresh, shouldHydrate)
              return
            }
            let staged = yield* loadRef.current(
              source,
              current,
              undefined,
              true,
              false,
              undefined,
              false,
            )
            for (
              let number = 1;
              staged?.next && !staged.error && number < (previous?.loadedPages ?? 1);
              number++
            )
              staged = yield* loadRef.current(
                source,
                current,
                staged.next,
                false,
                false,
                staged,
                false,
                staged.options,
              )
            if (generation.current !== current || !staged) return
            if (staged.error) {
              if (previous) update(source.key, { ...previous, stale: true, error: staged.error })
              return
            }
            update(source.key, staged)
            if (!staged.stale) fullSweepAt.current.set(sweepKey, Date.now())
          }),
        { concurrency: 3, discard: true },
      )
    }).pipe(Effect.ensuring(done))
    const polling = startPolling(semaphore.withPermits(1)(poll), {
      interval: 30000,
      onError: () => {},
    })
    moreRef.current = (key) =>
      commands.run(
        semaphore
          .withPermitsIfAvailable(1)(
            Effect.gen(function* () {
              const page = pageRef.current[key]
              if (!page || !page.source.connected || !focused || AppState.currentState !== 'active')
                return
              if (page.error) {
                forceNext.current = true
                setRevision((value) => value + 1)
                return
              }
              if (!page.next) return
              setBusy(true)
              const loaded = yield* loadRef
                .current(page.source, current, page.next)
                .pipe(Effect.ensuring(done))
              if (loaded && !loaded.error)
                fullSweepAt.current.set(
                  JSON.stringify([workSourceContentIdentity(page.source), mode, state, query]),
                  Date.now(),
                )
            }),
          )
          .pipe(Effect.asVoid),
      )
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') polling.refresh()
    })
    return () => {
      generation.current++
      moreRef.current = async () => {}
      subscription.remove()
      void polling.stop()
      void commands.stop()
    }
  }, [identity, state, mode, query, revision, focused])
  const refresh = () => {
    forceNext.current = true
    setRevision((value) => value + 1)
  }
  return {
    pages:
      lastQuery.current === JSON.stringify([state, mode, query])
        ? retainWorkPages(Object.values(pages), sources)
        : [],
    sources,
    busy,
    refresh,
    more: (key: string) => moreRef.current(key),
  }
}
