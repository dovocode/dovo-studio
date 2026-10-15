import { useEffect, useRef } from 'react'
import { Effect } from 'effect'
import { startPolling, useWorkspace, useRepositorySources } from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import { useDetailReader, verifySourceReader } from '../../connections/source-readers'
import {
  pullDetailSchema,
  forgeSourceIdentitySchema,
  RuntimeRequestError,
  type PullDetail as Detail,
} from '@dovo/protocol'

export function usePullDetail(repositoryId: string, number: number, connectionId?: string) {
  const {
    requestEffect: request,
    connected,
    workspace,
    readCache,
    activeRuntimeId,
  } = useWorkspace()
  const sources = useRepositorySources()
  const origin = sources.find(
    (source) => source.runtimeId === activeRuntimeId && source.repository.id === repositoryId,
  )
  const { reader, destination } = useDetailReader(
    origin,
    sources,
    JSON.stringify([repositoryId, number, connectionId]),
  )
  const readConnected = reader?.connected ?? (!origin && connected)
  const repository = workspace.repositories.find((repo) => repo.id === repositoryId)
  const cacheKey = JSON.stringify([
    'pulls',
    'detail',
    repositoryId,
    repository?.path ?? '',
    number,
    repository?.forge,
    ...(connectionId ? ['connection', connectionId] : []),
  ])
  const [state, setState] = useApplicationState({
    detail: null as Detail | null,
    error: '',
    busy: false,
    refreshing: false,
    revision: 0,
  })
  const forceNext = useRef(false)
  const urlIdentity = useRef<string | undefined>(undefined)
  const setError = (error: string) => setState((current) => ({ ...current, error }))
  useEffect(() => {
    urlIdentity.current = undefined
    setState((current) => ({ ...current, detail: null, error: '' }))
  }, [cacheKey, readCache])
  useEffect(() => {
    let stopped = false
    const hydrated = Effect.runSync(
      Effect.cached(
        Effect.gen(function* () {
          if (!readCache) return
          const cached = yield* readCache.readEffect(cacheKey, pullDetailSchema)
          if (cached && !stopped)
            setState((current) => ({
              ...current,
              detail: current.detail ?? {
                ...cached.value,
                stale: true,
                cachedAt: cached.value.cachedAt ?? cached.cachedAt,
              },
            }))
        }).pipe(
          Effect.catch(() =>
            Effect.sync(() => {
              if (!stopped) setError('Saved details could not be read from this device.')
            }),
          ),
        ),
      ),
    )
    let force = forceNext.current
    forceNext.current = false
    setState((current) => ({ ...current, busy: false, refreshing: false }))
    const load = Effect.gen(function* () {
      yield* hydrated
      if (!readConnected || document.visibilityState !== 'visible') return
      const refresh = force
      force = false
      setState((current) => ({ ...current, busy: true, refreshing: refresh }))
      const identity =
        !origin && repositoryId.startsWith('http')
          ? yield* request(
              '/api/scm/source/identity',
              { repositoryId, connectionId },
              forgeSourceIdentitySchema,
            ).pipe(
              Effect.catch((error) =>
                error instanceof RuntimeRequestError && [404, 405].includes(error.status ?? 0)
                  ? Effect.succeed(undefined)
                  : Effect.fail(error),
              ),
            )
          : undefined
      if (urlIdentity.current && identity?.readerIdentity !== urlIdentity.current)
        return yield* Effect.fail(
          new RuntimeRequestError({
            kind: 'request',
            status: 409,
            message: 'The PR account changed. Choose its account explicitly before refreshing.',
          }),
        )
      if (identity && !stopped) urlIdentity.current = identity.readerIdentity
      const readGuard = reader
        ? yield* verifySourceReader(reader)
        : {
            expectedReaderIdentity: identity?.readerIdentity,
            expectedDestination: identity?.destination,
          }
      yield* (reader?.requestEffect ?? request)(
        '/api/scm/pulls/detail',
        {
          repositoryId: reader?.repository.id ?? repositoryId,
          number,
          connectionId,
          refresh,
          ...readGuard,
        },
        pullDetailSchema,
      ).pipe(
        Effect.map((value) =>
          reader && reader.key !== origin?.key
            ? { ...value, destination, pull: { ...value.pull, destination } }
            : value,
        ),
        Effect.tap((value) =>
          Effect.sync(() => {
            if (!stopped) setState((current) => ({ ...current, detail: value, error: '' }))
          }),
        ),
        Effect.flatMap((value) =>
          (readCache ? readCache.writeEffect(cacheKey, value) : Effect.void).pipe(
            Effect.catch(() =>
              Effect.sync(() => {
                if (!stopped) setError('Details loaded, but could not be saved for offline use.')
              }),
            ),
          ),
        ),
      )
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (!stopped) setState((current) => ({ ...current, busy: false, refreshing: false }))
        }),
      ),
    )
    const polling = startPolling(load, {
      interval: 10000,
      onError: (error) => {
        if (!stopped) setError(error.message)
      },
    })
    document.addEventListener('visibilitychange', polling.refresh)
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', polling.refresh)
      void polling.stop()
    }
  }, [
    repositoryId,
    number,
    connectionId,
    cacheKey,
    readConnected,
    reader,
    destination,
    request,
    readCache,
    state.revision,
  ])
  const refresh = () => {
    if (!readConnected) return
    forceNext.current = true
    setState((current) => ({ ...current, refreshing: true, revision: current.revision + 1 }))
  }
  const invalidate = () => {
    void readCache
      ?.remove(cacheKey)
      .catch(() =>
        setError('Saved details could not be cleared. Refresh to load the latest discussion.'),
      )
    refresh()
  }
  return {
    readConnected,
    detail: state.detail,
    error: state.error,
    setError,
    busy: state.busy,
    refreshing: state.refreshing,
    refresh,
    invalidate,
  }
}
