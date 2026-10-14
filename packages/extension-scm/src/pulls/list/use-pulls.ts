import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useMemo, useRef } from 'react'
import { Effect, Schema, Semaphore } from 'effect'
import {
  pullRepositoryKey,
  publicPullSummaries,
  mutableArray,
  mutableStruct,
  pullPageSchema,
  useRepositorySources,
  startPolling,
  clientTaskScope,
  type RepositorySource,
} from '@dovo/studio-core'
import {
  useSourceReaders,
  verifySourceReader,
  chooseSourceReader,
} from '../../connections/source-readers'
import { refreshPageCount, refreshPullPage, type CachedPullPage } from './collection-pages'
type Page = CachedPullPage & { source: RepositorySource; error?: string }
const cachedPullPageSchema = mutableStruct({
  ...pullPageSchema.fields,
  firstPageIds: Schema.optional(mutableArray(Schema.String)),
})
const cacheKey = (source: RepositorySource, state: string) =>
  JSON.stringify([
    'pulls',
    'list',
    source.repository.id,
    source.repository.path,
    state,
    source.repository.forge,
  ])
export function usePulls(state: string, repositoryId = '') {
  const allSources = useRepositorySources()
  const origin = allSources.find((source) => source.key === repositoryId)
  const eligible = useMemo(
    () =>
      allSources.filter(
        (source) =>
          !repositoryId ||
          source.key === repositoryId ||
          (origin &&
            pullRepositoryKey(origin.repository, origin.key) ===
              pullRepositoryKey(source.repository, source.key)),
      ),
    [allSources, repositoryId],
  )
  const { sources, unavailable } = useSourceReaders(
    eligible,
    `pulls:${repositoryId}`,
    undefined,
    true,
    origin,
  )
  const [stored, setStored, pagesRef] = useApplicationState<Record<string, Page>>({})
  const [busy, setBusy] = useApplicationState(false)
  const [revision, setRevision] = useApplicationState(0)
  const forceNext = useRef(false)
  const fullSweepAt = useRef(new Map<string, number>())
  const generation = useRef(0)
  const lastState = useRef(state)
  const moreRef = useRef<(key: string) => Promise<void>>(async () => {})
  const remoteState = state === 'merged' ? 'closed' : state
  useEffect(() => {
    const current = ++generation.current
    const previousPages = pagesRef.current
    const sameState = lastState.current === remoteState
    const sweepKeys = new Set(sources.map((source) => JSON.stringify([source.scope, remoteState])))
    for (const key of fullSweepAt.current.keys())
      if (!sweepKeys.has(key)) fullSweepAt.current.delete(key)
    const semaphore = Effect.runSync(Semaphore.make(1))
    const commands = clientTaskScope()
    const update = (source: RepositorySource, page: CachedPullPage, error?: string) => {
      if (current !== generation.current) return
      setStored((previous) => ({ ...previous, [source.key]: { ...page, source, error } }))
    }
    setStored((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(
          ([key, page]) =>
            sameState &&
            (sources.some((source) => source.key === key && source.scope === page.source.scope) ||
              unavailable.has(pullRepositoryKey(page.source.repository, page.source.key))),
        ),
      ),
    )
    lastState.current = remoteState
    const save = (source: RepositorySource, page: CachedPullPage) =>
      source.readCache
        .writeEffect(cacheKey(source, remoteState), page)
        .pipe(
          Effect.catch(() =>
            Effect.sync(() =>
              update(source, page, 'PRs loaded, but could not be saved for offline use.'),
            ),
          ),
        )
    // A remote that moved to another computer keeps its last rows until that computer answers.
    for (const source of sources) {
      if (pagesRef.current[source.key]) continue
      const remote = pullRepositoryKey(source.repository, source.key)
      const carried = Object.values(previousPages).find(
        (page) => pullRepositoryKey(page.source.repository, page.source.key) === remote,
      )
      if (carried && sameState)
        update(
          source,
          {
            ...carried,
            pulls: publicPullSummaries(carried.pulls),
            page: 1,
            firstPageIds: undefined,
            hasMore: false,
            stale: true,
          },
          undefined,
        )
    }
    const hydrated = Effect.runSync(
      Effect.cached(
        Effect.forEach(
          sources,
          (source) =>
            Effect.gen(function* () {
              if (pagesRef.current[source.key]) return
              const cached = yield* source.readCache.readEffect(
                cacheKey(source, remoteState),
                cachedPullPageSchema,
              )
              if (cached && !pagesRef.current[source.key])
                update(source, {
                  ...cached.value,
                  stale: true,
                  cachedAt: cached.value.cachedAt ?? cached.cachedAt,
                })
            }).pipe(
              Effect.catch(() =>
                Effect.sync(() =>
                  update(
                    source,
                    { pulls: [], page: 0, hasMore: false },
                    'Saved PRs could not be read from this device.',
                  ),
                ),
              ),
            ),
          { concurrency: 3, discard: true },
        ),
      ),
    )
    let force = forceNext.current
    forceNext.current = false
    const load = Effect.gen(function* () {
      yield* hydrated
      if (document.visibilityState !== 'visible') return
      const refresh = force
      force = false
      setBusy(
        sources.some((source) => source.connected) &&
          (refresh || !sources.some((source) => !!pagesRef.current[source.key])),
      )
      yield* Effect.forEach(
        sources.filter((source) => source.connected),
        (source) =>
          Effect.gen(function* () {
            const expectedReaderIdentity = yield* verifySourceReader(source)
            const previous = pagesRef.current[source.key]
            const sweepKey = JSON.stringify([source.scope, remoteState])
            const lastSweep = fullSweepAt.current.get(sweepKey) ?? Date.now()
            if (!fullSweepAt.current.has(sweepKey)) fullSweepAt.current.set(sweepKey, lastSweep)
            // Rebuild older saved pages once; sweep later pages every two minutes.
            const count = refreshPageCount(previous, refresh, lastSweep, Date.now())
            let page: CachedPullPage = { pulls: [], page: 0, hasMore: true }
            for (let number = 1; number <= count && page.hasMore; number++) {
              const response = yield* source.requestEffect(
                '/api/scm/pulls/overview',
                {
                  repositoryId: source.repository.id,
                  expectedReaderIdentity,
                  state: remoteState,
                  page: number,
                  refresh,
                },
                pullPageSchema,
              )
              if (number === 1)
                page =
                  count === 1
                    ? refreshPullPage(previous, response, refresh)
                    : refreshPullPage(undefined, response, refresh)
              else
                page = {
                  ...response,
                  firstPageIds: page.firstPageIds,
                  stale: page.stale || response.stale,
                  refreshError: page.refreshError || response.refreshError,
                  pulls: [
                    ...new Map(
                      [...page.pulls, ...response.pulls].map((pull) => [pull.number, pull]),
                    ).values(),
                  ],
                }
            }
            update(source, page, page.refreshError)
            yield* save(source, page)
            if (count > 1 && !page.stale && !page.refreshError)
              fullSweepAt.current.set(sweepKey, Date.now())
          }).pipe(
            Effect.catch((error) =>
              Effect.sync(() =>
                update(
                  source,
                  {
                    ...(pagesRef.current[source.key] ?? { pulls: [], page: 0, hasMore: false }),
                    stale: true,
                  },
                  error.message,
                ),
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
        if (!previous || !source?.connected) return
        if (previous.error) {
          force = true
          polling.refresh()
          return
        }
        setBusy(true)
        yield* Effect.gen(function* () {
          const expectedReaderIdentity = yield* verifySourceReader(source)
          const next = yield* source.requestEffect(
            '/api/scm/pulls/overview',
            {
              repositoryId: source.repository.id,
              state: remoteState,
              page: previous.page + 1,
              expectedReaderIdentity,
            },
            pullPageSchema,
          )
          const page = {
            ...next,
            firstPageIds: previous.firstPageIds,
            stale: previous.stale || next.stale,
            refreshError: previous.refreshError || next.refreshError,
            pulls: [
              ...new Map(
                [...previous.pulls, ...next.pulls].map((pull) => [pull.number, pull]),
              ).values(),
            ],
          }
          update(source, page, page.refreshError)
          yield* save(source, page)
          if (!page.stale && !page.refreshError)
            fullSweepAt.current.set(JSON.stringify([source.scope, remoteState]), Date.now())
        }).pipe(
          Effect.catch((error) => Effect.sync(() => update(source, previous, error.message))),
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
  }, [sources, unavailable, remoteState, revision])
  const refresh = () => {
    forceNext.current = true
    setRevision((value) => value + 1)
  }
  const selectedPages = sources.flatMap((source) => {
    const page = stored[source.key]
    return page && page.source.scope === source.scope && lastState.current === remoteState
      ? [{ ...page, source }]
      : []
  })
  const pages = [
    ...selectedPages,
    ...Object.values(stored)
      .filter(
        (page) =>
          unavailable.has(pullRepositoryKey(page.source.repository, page.source.key)) &&
          lastState.current === remoteState,
      )
      .map((page) => ({
        ...page,
        stale: true,
        source: { ...page.source, connected: false },
        error:
          'The original reader is unavailable. A different or unverified account cannot take over. Choose a project source explicitly to continue.',
      })),
  ]
  return {
    sources: allSources,
    pages,
    busy,
    connected: sources.some((source) => source.connected),
    chooseReader: async (key: string) => {
      const source = allSources.find((source) => source.key === key)
      if (!source?.connected) return
      await Effect.runPromise(
        chooseSourceReader(
          source,
          `pulls:${key}`,
          pullRepositoryKey(source.repository, source.key),
        ),
      )
      setStored((previous) =>
        Object.fromEntries(Object.entries(previous).filter(([entryKey]) => entryKey !== key)),
      )
    },
    more: (key: string) => moreRef.current(key),
    refresh,
  }
}
