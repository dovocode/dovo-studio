import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useRef } from 'react'
import { Effect } from 'effect'
import {
  pullPageSchema,
  useRepositorySources,
  startPolling,
  clientTaskScope,
  type PullPage,
  type RepositorySource,
} from '@dovo/studio-core'
type Page = PullPage & { source: RepositorySource; error?: string }
const cacheKey = (source: RepositorySource, state: string) =>
  JSON.stringify([
    'pulls',
    'list',
    source.repository.id,
    source.repository.path,
    state,
    source.repository.forge,
  ])
export function usePulls(state: string) {
  const sources = useRepositorySources()
  const [stored, setStored, pagesRef] = useApplicationState<Record<string, Page>>({})
  const [busy, setBusy] = useApplicationState(false)
  const [revision, setRevision] = useApplicationState(0)
  const forceNext = useRef(false)
  const generation = useRef(0)
  const lastState = useRef(state)
  const moreRef = useRef<(key: string) => Promise<void>>(async () => {})
  const remoteState = state === 'merged' ? 'closed' : state
  useEffect(() => {
    const current = ++generation.current
    const semaphore = Effect.runSync(Effect.makeSemaphore(1))
    const commands = clientTaskScope()
    const update = (source: RepositorySource, page: PullPage, error?: string) => {
      if (current !== generation.current) return
      setStored((previous) => ({ ...previous, [source.key]: { ...page, source, error } }))
    }
    setStored((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(
          ([key, page]) =>
            lastState.current === remoteState &&
            sources.some((source) => source.key === key && source.scope === page.source.scope),
        ),
      ),
    )
    lastState.current = remoteState
    const save = (source: RepositorySource, page: PullPage) =>
      source.readCache
        .writeEffect(cacheKey(source, remoteState), page)
        .pipe(
          Effect.catchAll(() =>
            Effect.sync(() =>
              update(source, page, 'PRs loaded, but could not be saved for offline use.'),
            ),
          ),
        )
    const hydrated = Effect.runSync(
      Effect.cached(
        Effect.forEach(
          sources,
          (source) =>
            Effect.gen(function* () {
              if (pagesRef.current[source.key]) return
              const cached = yield* source.readCache.readEffect(
                cacheKey(source, remoteState),
                pullPageSchema,
              )
              if (cached && !pagesRef.current[source.key])
                update(source, {
                  ...cached.value,
                  stale: true,
                  cachedAt: cached.value.cachedAt ?? cached.cachedAt,
                })
            }).pipe(
              Effect.catchAll(() =>
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
      setBusy(sources.some((source) => source.connected))
      yield* Effect.forEach(
        sources.filter((source) => source.connected),
        (source) =>
          Effect.gen(function* () {
            const count = refresh ? 1 : Math.max(1, pagesRef.current[source.key]?.page ?? 1)
            let page: PullPage = { pulls: [], page: 0, hasMore: true }
            for (let number = 1; number <= count && page.hasMore; number++) {
              const response = yield* source.requestEffect(
                '/api/scm/pulls/overview',
                {
                  repositoryId: source.repository.id,
                  state: remoteState,
                  page: number,
                  refresh,
                },
                pullPageSchema,
              )
              page = {
                ...response,
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
          }).pipe(
            Effect.catchAll((error) =>
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
          const next = yield* source.requestEffect(
            '/api/scm/pulls/overview',
            {
              repositoryId: source.repository.id,
              state: remoteState,
              page: previous.page + 1,
            },
            pullPageSchema,
          )
          const page = {
            ...next,
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
        }).pipe(
          Effect.catchAll((error) => Effect.sync(() => update(source, previous, error.message))),
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
  }, [sources, remoteState, revision])
  const refresh = () => {
    forceNext.current = true
    setRevision((value) => value + 1)
  }
  const pages = sources.flatMap((source) => {
    const page = stored[source.key]
    return page && page.source.scope === source.scope && lastState.current === remoteState
      ? [{ ...page, source }]
      : []
  })
  return {
    sources,
    pages,
    busy,
    connected: sources.some((source) => source.connected),
    more: (key: string) => moreRef.current(key),
    refresh,
  }
}
