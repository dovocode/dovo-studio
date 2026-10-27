import { useCallback, useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import { Effect, Schema, Semaphore } from 'effect'
import { startPolling, clientTaskScope, runClientEffect } from '@dovo/client-runtime'
import {
  assignRemoteSources,
  pullRepositoryKey,
  publicPullSummaries,
  retainNewerPullSnapshot,
  mutableArray,
  mutableStruct,
  pullPageSchema,
  type PullPage,
} from '@dovo/protocol'
import { useApplicationState } from '../../../runtime/state/application-state'
import { useRuntime } from '../../../runtime/connection/provider'
import {
  collectionSources,
  collectionSourceIdentity,
  projectContentIdentity,
  type ProjectSource,
} from '../../../runtime/state/collection-sources'
import { useSourceIdentities, verifiedSourceRead } from '../../source-reader'
import { mobileReaders } from '../../verified-reader'
import { useNavigation } from '../../../shell/navigation'
import { acknowledgePullList, pullListRevision } from './pull-list-invalidation'
type Page = PullPage & {
  sourceKey: string
  remoteKey: string
  sourceIdentity: string
  runtimeId: string
  runtimeName: string
  connected: boolean
  readConnected: boolean
  repositoryId: string
  name: string
  error?: string
  firstPageIds?: string[]
}
type PullSource = ProjectSource & { reader: ProjectSource }
const cachedPullPageSchema = mutableStruct({
  ...pullPageSchema.fields,
  firstPageIds: Schema.optional(mutableArray(Schema.String)),
})
type Repository = { id: string; name: string; path: string; forge?: unknown }
const cacheKey = (repository: Repository, state: string) =>
  JSON.stringify(['pulls', 'list', repository.id, repository.path, state, repository.forge])
export function usePulls(repositoryId: string, state: string) {
  const { focused: enabled } = useNavigation()
  const { readRuntimeEffect: rawRead, overviews, cacheForRuntime, activeId } = useRuntime()
  const available = collectionSources(overviews)
  const requested = available.find((source) => source.key === repositoryId)
  const remote = requested && pullRepositoryKey(requested.repository, requested.key)
  const allSources = available.filter((source) => !repositoryId || source.key === repositoryId)
  const identified = useSourceIdentities(
    allSources,
    projectContentIdentity,
    (source) => ({ repositoryId: source.repository.id }),
    enabled,
  )
  const readers = mobileReaders.selection(JSON.stringify(['pulls', repositoryId]))
  // A stable source key can be rebound to a different remote. Drop that old
  // association before assigning readers so one origin cannot own both remotes.
  for (const [remote, key] of readers.origins) {
    const origin = available.find((source) => source.key === key)
    if (origin && pullRepositoryKey(origin.repository, origin.key) !== remote) {
      readers.origins.delete(remote)
    }
  }
  // A project filter pins both reads and account discovery to that source.
  if (requested && remote && !readers.owners.has(remote)) {
    readers.owners.set(remote, requested.key)
    readers.origins.set(remote, requested.key)
  }
  for (const source of identified) {
    const remote = pullRepositoryKey(source.repository, source.key)
    if (
      readers.origins.get(remote) === source.key &&
      source.readerIdentity &&
      !readers.readerIdentities.has(remote)
    )
      readers.readerIdentities.set(remote, source.readerIdentity)
  }
  const assigned = assignRemoteSources(
    identified.map((source) => ({ ...source, runtimeId: source.profile.id })),
    {
      previous: readers.owners,
      previousReaderIdentities: readers.readerIdentities,
      requireSameReader: true,
      allowHandoff: false,
      sharedPreference: identified.every((source) => !!source.serverId),
      preferredRuntimeId: activeId,
    },
  )
  for (const [remote, owner] of assigned.owners) readers.owners.set(remote, owner)
  for (const source of assigned.selected) {
    const remote = pullRepositoryKey(source.repository, source.key)
    if (!readers.origins.has(remote)) readers.origins.set(remote, source.key)
    if (source.readerIdentity)
      readers.readerIdentities.set(
        pullRepositoryKey(source.repository, source.key),
        source.readerIdentity,
      )
  }
  const request = useCallback(
    (
      source: PullSource,
      input: { repositoryId: string; state: string; page: number; refresh?: boolean },
    ) => {
      const reader = source.reader
      const originIdentity = mobileReaders.identity(projectContentIdentity(source))
      if (source.key !== reader.key && !originIdentity)
        return Effect.fail(
          new Error('The original account is unavailable. Connect its runtime to continue.'),
        )
      return verifiedSourceRead(
        (path, body, schema, method) => rawRead(reader.profile, path, body, schema, method),
        projectContentIdentity(reader),
        { repositoryId: reader.repository.id },
        source.key !== reader.key ? originIdentity?.readerIdentity : undefined,
      )(
        '/api/scm/pulls/overview',
        { ...input, repositoryId: reader.repository.id },
        pullPageSchema,
      ).pipe(
        Effect.map((page) => {
          if (source.key === reader.key) return page
          const destination = originIdentity?.destination
          return {
            ...page,
            destination,
            pulls: page.pulls.map((pull) => ({ ...pull, destination })),
          }
        }),
      )
    },
    [rawRead],
  )
  const sources: PullSource[] = assigned.selected.flatMap((reader) => {
    const origin = allSources.find(
      (source) =>
        source.key === readers.origins.get(pullRepositoryKey(reader.repository, reader.key)) &&
        pullRepositoryKey(source.repository, source.key) ===
          pullRepositoryKey(reader.repository, reader.key),
    )
    return origin ? [{ ...origin, reader }] : []
  })
  const key = JSON.stringify([
    collectionSourceIdentity(sources),
    collectionSourceIdentity(sources.map((source) => source.reader)),
  ])
  const sourcesRef = useRef(sources)
  sourcesRef.current = sources
  const connected = sources.some((source) => source.reader.connected)
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
    const semaphore = Effect.runSync(Semaphore.make(1))
    const commands = clientTaskScope()
    const update = (id: string, page: Page) => {
      if (current === generation.current) setPages((previous) => ({ ...previous, [id]: page }))
    }
    const metadata = (entry: (typeof repositories)[number]) => ({
      sourceKey: entry.key,
      remoteKey: pullRepositoryKey(entry.repository, entry.key),
      sourceIdentity: projectContentIdentity(entry),
      runtimeId: entry.profile.id,
      runtimeName: entry.computerName,
      connected: entry.connected,
      readConnected: entry.reader.connected,
      repositoryId: entry.repository.id,
      name: entry.repository.name,
    })
    setPages((previous) => {
      if (sourceState.current !== remoteState) return {}
      const retained: Record<string, Page> = Object.fromEntries(
        Object.entries(previous)
          .filter(
            ([, page]) =>
              !repositories.some((source) => source.key === page.sourceKey) &&
              readers.origins.get(page.remoteKey) === page.sourceKey,
          )
          .map(([key, page]) => [
            key,
            {
              ...page,
              connected: false,
              readConnected: false,
              stale: true,
              error: 'The original account is unavailable. Choose a source to continue.',
            },
          ]),
      )
      for (const entry of repositories) {
        const saved = previous[entry.key]
        if (saved?.sourceIdentity === projectContentIdentity(entry)) {
          retained[entry.key] = { ...saved, ...metadata(entry) }
          continue
        }
        const remote = pullRepositoryKey(entry.repository, entry.key)
        const carried = Object.values(previous).find(
          (page) => page.remoteKey === remote && page.sourceKey !== entry.key,
        )
        if (carried)
          retained[entry.key] = {
            ...carried,
            ...metadata(entry),
            pulls: publicPullSummaries(carried.pulls),
            stale: true,
            page: 1,
            firstPageIds: undefined,
            hasMore: false,
            error: undefined,
          }
      }
      return retained
    })
    sourceState.current = remoteState
    const save = (entry: (typeof repositories)[number], page: Page) =>
      Schema.decodeUnknownEffect(cachedPullPageSchema)(page).pipe(
        Effect.flatMap((value) =>
          cacheForRuntime(entry.profile).writeEffect(
            cacheKey(entry.repository, remoteState),
            value,
          ),
        ),
        Effect.catch(() =>
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
              Effect.catch(() =>
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
        repositories.filter((entry) => entry.reader.connected),
        (entry) =>
          Effect.gen(function* () {
            const cache = cacheForRuntime(entry.profile)
            const invalidated = pullListRevision(cache, entry.repository.id)
            const refresh = forced || !!invalidated
            const previous = pagesRef.current[entry.key]
            const response = yield* request(entry, {
              repositoryId: entry.repository.id,
              state: remoteState,
              page: 1,
              refresh,
            })
            const retained = retainNewerPullSnapshot<PullPage>(previous, response)
            const firstPageIds = response.pulls.map((pull) => String(pull.number))
            const changed = JSON.stringify(previous?.firstPageIds) !== JSON.stringify(firstPageIds)
            // Publish only after the entire opened prefix has been revalidated.
            let combined = response
            if (retained === response)
              for (let number = 2; combined.hasMore && number <= (previous?.page ?? 1); number++) {
                const next = yield* request(entry, {
                  repositoryId: entry.repository.id,
                  state: remoteState,
                  page: number,
                  // A membership change invalidates independently cached page boundaries.
                  refresh: refresh || changed,
                })
                if (next.stale || next.refreshError)
                  return yield* Effect.fail(
                    new Error(
                      next.refreshError ?? 'Older PR pages are unavailable; showing saved results.',
                    ),
                  )
                combined = {
                  ...next,
                  cachedAt: response.cachedAt,
                  stale: response.stale,
                  refreshError: response.refreshError,
                  pulls: [
                    ...new Map(
                      [...combined.pulls, ...next.pulls].map((pull) => [pull.number, pull]),
                    ).values(),
                  ],
                }
              }
            const page: Page =
              retained !== response && previous
                ? {
                    ...previous,
                    ...metadata(entry),
                    stale: true,
                    refreshError: retained.refreshError,
                    error: retained.refreshError,
                  }
                : {
                    ...combined,
                    ...metadata(entry),
                    error: combined.refreshError,
                    stale: !!combined.stale || !!combined.refreshError,
                    firstPageIds,
                  }
            update(entry.key, page)
            if (!page.stale && !page.error)
              acknowledgePullList(cache, entry.repository.id, invalidated)
            yield* save(entry, page)
          }).pipe(
            Effect.catch((error) =>
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
        if (!previous || !entry?.reader.connected || !enabled) return
        if (previous.error) {
          force = true
          polling.refresh()
          return
        }
        setBusy(true)
        yield* Effect.gen(function* () {
          const next = yield* request(entry, {
            repositoryId: entry.repository.id,
            state: remoteState,
            page: previous.page + 1,
          })
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
          Effect.catch((error) =>
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
          if (!entry && readers.origins.get(page.remoteKey) === page.sourceKey)
            return [
              {
                ...page,
                connected: false,
                readConnected: false,
                stale: true,
                error: 'The original account is unavailable. Choose a source to continue.',
              },
            ]
          return entry && page.sourceIdentity === projectContentIdentity(entry)
            ? [
                {
                  ...page,
                  runtimeName: entry.computerName,
                  name: entry.repository.name,
                  connected: entry.connected,
                  readConnected: entry.reader.connected,
                  stale: page.stale || !entry.reader.connected,
                },
              ]
            : []
        })
  return {
    pages: values,
    sources: allSources,
    busy,
    connected,
    more: (id: string) => moreRef.current(id),
    refresh,
    chooseSource: async (sourceKey: string) => {
      const source = allSources.find((source) => source.key === sourceKey)
      if (!source) return
      await runClientEffect(
        cacheForRuntime(source.profile).removeEffect(cacheKey(source.repository, remoteState)),
      )
      mobileReaders.acceptAccount(projectContentIdentity(source))
      mobileReaders.resetSelection(JSON.stringify(['pulls', sourceKey]))
      setPages({})
      setRevision((value) => value + 1)
    },
  }
}
