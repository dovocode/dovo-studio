import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import { Effect, Schema } from 'effect'
import { startPolling, clientTaskScope } from '@dovo/client-runtime'
import { mutableArray, mutableStruct, pullPageSchema, type PullPage } from '@dovo/protocol'
import { useApplicationState } from '../runtime/application-state'
import { refreshFirstPage } from './collection-pages'
import { useRuntime } from '../runtime/provider'
import {
  collectionSources,
  collectionSourceIdentity,
  projectContentIdentity,
} from '../runtime/collection-sources'
import { useNavigation } from '../shell/navigation'
import { acknowledgePullList, pullListRevision } from './pull-list-invalidation'
type Page = PullPage & {
  sourceKey: string
  sourceIdentity: string
  runtimeId: string
  runtimeName: string
  connected: boolean
  repositoryId: string
  name: string
  error?: string
  firstPageIds?: string[]
}
const cachedPullPageSchema = mutableStruct({
  ...pullPageSchema.fields,
  firstPageIds: Schema.optional(mutableArray(Schema.String)),
})
type Repository = { id: string; name: string; path: string; forge?: unknown }
const cacheKey = (repository: Repository, state: string) =>
  JSON.stringify(['pulls', 'list', repository.id, repository.path, state, repository.forge])
export function usePulls(repositoryId: string, state: string) {
  const { focused: enabled } = useNavigation()
  const { readRuntimeEffect: request, overviews, cacheForRuntime } = useRuntime()
  const sources = collectionSources(overviews).filter(
    (source) => !repositoryId || source.key === repositoryId,
  )
  const key = collectionSourceIdentity(sources)
  const sourcesRef = useRef(sources)
  sourcesRef.current = sources
  const connected = sources.some((source) => source.connected)
  const [pages, setPages, pagesRef] = useApplicationState<Record<string, Page>>({})
  const [busy, setBusy] = useApplicationState(false)
  const [revision, setRevision] = useApplicationState(0)
  const forceNext = useRef(false)
  const sourceState = useRef('')
  const generation = useRef(0)
  const moreRef = useRef<(id: string) => Promise<void>>(async () => {})
  const remoteState = state === 'merged' ? 'closed' : state
  useEffect(() => {
    const current = ++generation.current
    const repositories = sourcesRef.current
    const currentSources = new Map(repositories.map((entry) => [entry.key, entry]))
    setPages((previous) =>
      sourceState.current !== remoteState
        ? {}
        : Object.fromEntries(
            Object.entries(previous).filter(([id, page]) => {
              const entry = currentSources.get(id)
              return entry && page.sourceIdentity === projectContentIdentity(entry)
            }),
          ),
    )
    sourceState.current = remoteState
    const semaphore = Effect.runSync(Effect.makeSemaphore(1))
    const commands = clientTaskScope()
    const update = (id: string, page: Page) => {
      if (current === generation.current) setPages((previous) => ({ ...previous, [id]: page }))
    }
    const metadata = (entry: (typeof repositories)[number]) => ({
      sourceKey: entry.key,
      sourceIdentity: projectContentIdentity(entry),
      runtimeId: entry.profile.id,
      runtimeName: entry.profile.name,
      connected: entry.connected,
      repositoryId: entry.repository.id,
      name: entry.repository.name,
    })
    const save = (entry: (typeof repositories)[number], page: Page) =>
      Schema.decodeUnknown(cachedPullPageSchema)(page).pipe(
        Effect.flatMap((value) =>
          cacheForRuntime(entry.profile).writeEffect(
            cacheKey(entry.repository, remoteState),
            value,
          ),
        ),
        Effect.catchAll(() =>
          Effect.sync(() =>
            update(entry.key, {
              ...page,
              error: 'PRs loaded, but could not be saved for offline use.',
            }),
          ),
        ),
      )
    const hydrated = Effect.runSync(
      Effect.cached(
        Effect.forEach(
          repositories,
          (entry) =>
            Effect.gen(function* () {
              const cached = yield* cacheForRuntime(entry.profile).readEffect(
                cacheKey(entry.repository, remoteState),
                cachedPullPageSchema,
              )
              if (cached && !pagesRef.current[entry.key])
                update(entry.key, {
                  ...cached.value,
                  ...metadata(entry),
                  stale: true,
                  cachedAt: cached.value.cachedAt ?? cached.cachedAt,
                })
            }).pipe(
              Effect.catchAll(() =>
                Effect.sync(() => {
                  if (!pagesRef.current[entry.key])
                    update(entry.key, {
                      ...metadata(entry),
                      pulls: [],
                      page: 0,
                      hasMore: false,
                      error: 'Saved PRs could not be read from this device.',
                    })
                }),
              ),
            ),
          { concurrency: 3, discard: true },
        ),
      ),
    )
    let force = forceNext.current
    forceNext.current = false
    setBusy(connected && enabled)
    const load = Effect.gen(function* () {
      yield* hydrated
      if (!connected || !enabled || AppState.currentState !== 'active') return
      const forced = force
      force = false
      yield* Effect.forEach(
        repositories.filter((entry) => entry.connected),
        (entry) =>
          Effect.gen(function* () {
            const cache = cacheForRuntime(entry.profile)
            const invalidated = pullListRevision(cache, entry.repository.id)
            const refresh = forced || !!invalidated
            const response = yield* request(
              entry.profile,
              '/api/scm/pulls/overview',
              {
                repositoryId: entry.repository.id,
                state: remoteState,
                page: 1,
                refresh,
              },
              pullPageSchema,
            )
            const previous = pagesRef.current[entry.key]
            const page: Page = {
              ...response,
              ...metadata(entry),
              error: response.refreshError,
              firstPageIds: response.pulls.map((pull) => String(pull.number)),
              ...(previous?.page > 1 && previous.firstPageIds && !refresh
                ? {
                    page: previous.page,
                    hasMore: previous.hasMore,
                    stale: previous.stale || response.stale,
                    error: response.refreshError || previous.error,
                    pulls: refreshFirstPage(
                      previous.pulls,
                      previous.firstPageIds,
                      response.pulls,
                      (pull) => String(pull.number),
                    ),
                  }
                : {}),
            }
            update(entry.key, page)
            if (!response.stale && !response.refreshError)
              acknowledgePullList(cache, entry.repository.id, invalidated)
            yield* save(entry, page)
          }).pipe(
            Effect.catchAll((error) =>
              Effect.sync(() =>
                update(entry.key, {
                  ...(pagesRef.current[entry.key] ?? { pulls: [], hasMore: false, page: 0 }),
                  ...metadata(entry),
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
      interval: 10000,
      onError: () => {},
    })
    const more = (id: string) =>
      Effect.gen(function* () {
        const previous = pagesRef.current[id]
        const entry = repositories.find((item) => item.key === id)
        if (!previous || !entry?.connected || !enabled) return
        if (previous.error) {
          force = true
          polling.refresh()
          return
        }
        setBusy(true)
        yield* Effect.gen(function* () {
          const next = yield* request(
            entry.profile,
            '/api/scm/pulls/overview',
            {
              repositoryId: entry.repository.id,
              state: remoteState,
              page: previous.page + 1,
            },
            pullPageSchema,
          )
          const page = {
            ...previous,
            ...next,
            stale: previous.stale || next.stale,
            error: next.refreshError || previous.error,
            pulls: [
              ...new Map(
                [...previous.pulls, ...next.pulls].map((pull) => [pull.number, pull]),
              ).values(),
            ],
          }
          update(id, page)
          yield* save(entry, page)
        }).pipe(
          Effect.catchAll((error) =>
            Effect.sync(() => update(id, { ...previous, error: error.message })),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              if (current === generation.current) setBusy(false)
            }),
          ),
        )
      })
    moreRef.current = (id) =>
      commands.run(semaphore.withPermitsIfAvailable(1)(more(id)).pipe(Effect.asVoid))
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
  }, [key, remoteState, connected, request, cacheForRuntime, revision, enabled])
  const refresh = () => {
    forceNext.current = true
    setRevision((value) => value + 1)
  }
  const currentSources = new Map(sources.map((entry) => [entry.key, entry]))
  const values =
    sourceState.current !== remoteState
      ? []
      : Object.values(pages).flatMap((page) => {
          const entry = currentSources.get(page.sourceKey)
          return entry && page.sourceIdentity === projectContentIdentity(entry)
            ? [
                {
                  ...page,
                  runtimeName: entry.profile.name,
                  name: entry.repository.name,
                  connected: entry.connected,
                },
              ]
            : []
        })
  return {
    pages: values,
    sources,
    busy,
    connected,
    more: (id: string) => moreRef.current(id),
    refresh,
  }
}
