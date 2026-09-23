import { Effect } from 'effect'
import { clientTaskScope } from '@dovo/client-runtime'
import { useApplicationState } from '../runtime/application-state'
import { useEffect, useRef } from 'react'
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
  workSourceInput,
  type WorkSource,
  retainWorkPages,
} from './work-sources'
import { useNavigation } from '../shell/navigation'
import { workCacheKey } from './work-cache'
import { refreshFirstPage } from './collection-pages'
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
  const [busy, setBusy] = useApplicationState(false)
  const [revision, setRevision] = useApplicationState(0)
  const lastQuery = useRef('')
  const update = (key: string, page: WorkPage) =>
    setPages((previous) => ({ ...previous, [key]: page }))
  const load = (source: WorkSource, current: number, cursor?: string, force = false) =>
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
      let page: WorkPage = pageRef.current[source.key] ?? {
        source,
        items: [],
        stale: true,
      }
      yield* Effect.gen(function* () {
        if (!cursor) {
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
          update(source.key, page)
        }
      }).pipe(
        Effect.catchAll(() =>
          Effect.sync(() => {
            page = {
              ...page,
              error: 'Saved work could not be read from this device.',
            }
            if (generation.current === current) update(source.key, page)
          }),
        ),
      )
      if (!source.connected || generation.current !== current || !focused) return
      yield* Effect.gen(function* () {
        const options = yield* readRuntime(
          source.profile,
          '/api/scm/work/options',
          {
            ...workSourceInput(source),
            area: mode,
          },
          forgeWorkOptionsSchema,
        )
        if (generation.current !== current) return
        if (!(mode === 'issues' ? options.issues : options.pipelines)) {
          update(source.key, {
            source,
            options,
            items: [],
            stale: false,
          })
          yield* cache.writeEffect(optionsKey, options)
          return
        }
        const sourceState =
          state === 'all'
            ? 'all'
            : options.provider === 'jira'
              ? state
              : options.issueStates.find((value) => value.toLowerCase() === state.toLowerCase())
        if (mode === 'issues' && !sourceState) {
          update(source.key, {
            source,
            options,
            items: [],
            stale: false,
          })
          return
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
        const retaining = !cursor && !force && page.paginated && page.firstPageIds
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
          next: retaining ? page.next : data.next,
          stale: !!data.stale || !!data.refreshError || ((!!cursor || !!retaining) && page.stale),
          error: data.refreshError || (cursor || retaining ? page.error : undefined),
        }
        update(source.key, next)
        yield* Effect.all(
          [cache.writeEffect(optionsKey, options), cache.writeEffect(pageKey, data)],
          { concurrency: 2 },
        ).pipe(
          Effect.catchAll(() =>
            Effect.sync(() => {
              if (generation.current === current)
                update(source.key, {
                  ...next,
                  error: 'Work loaded, but could not be saved for offline use.',
                })
            }),
          ),
        )
      }).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            if (generation.current === current)
              update(source.key, {
                ...page,
                source,
                stale: true,
                error: error.message,
              })
          }),
        ),
      )
    })
  const loadRef = useRef(load)
  loadRef.current = load
  useEffect(() => {
    const current = ++generation.current
    const queryKey = JSON.stringify([state, mode, query])
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
    setBusy(focused && sourcesRef.current.some((source) => source.connected))
    const force = forceNext.current
    forceNext.current = false
    const commands = clientTaskScope()
    const semaphore = Effect.runSync(Effect.makeSemaphore(1))
    const done = Effect.sync(() => {
      if (generation.current === current) setBusy(false)
    })
    void commands.run(
      semaphore.withPermits(1)(
        Effect.forEach(
          sourcesRef.current,
          (source) => loadRef.current(source, current, undefined, force),
          { concurrency: 3, discard: true },
        ).pipe(Effect.ensuring(done)),
      ),
    )
    moreRef.current = (key) =>
      commands.run(
        semaphore
          .withPermitsIfAvailable(1)(
            Effect.gen(function* () {
              const page = pageRef.current[key]
              if (!page || !page.source.connected || !focused) return
              if (page.error) {
                forceNext.current = true
                setRevision((value) => value + 1)
                return
              }
              if (!page.next) return
              setBusy(true)
              yield* loadRef.current(page.source, current, page.next).pipe(Effect.ensuring(done))
            }),
          )
          .pipe(Effect.asVoid),
      )
    return () => {
      generation.current++
      moreRef.current = async () => {}
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
