import { useEffect, useRef } from 'react'
import { Effect } from 'effect'
import { startPolling, useWorkspace } from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import { pullDetailSchema, type PullDetail as Detail } from '@dovo/protocol'

export function usePullDetail(repositoryId: string, number: number) {
  const { requestEffect: request, connected, workspace, readCache } = useWorkspace()
  const repository = workspace.repositories.find((repo) => repo.id === repositoryId)
  const cacheKey = JSON.stringify([
    'pulls',
    'detail',
    repositoryId,
    repository?.path ?? '',
    number,
    repository?.forge,
  ])
  const [state, setState] = useApplicationState({
    detail: null as Detail | null,
    error: '',
    busy: false,
    refreshing: false,
    revision: 0,
  })
  const forceNext = useRef(false)
  const setError = (error: string) => setState((current) => ({ ...current, error }))
  useEffect(() => {
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
          Effect.catchAll(() =>
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
      if (!connected || document.visibilityState !== 'visible') return
      const refresh = force
      force = false
      setState((current) => ({ ...current, busy: true, refreshing: refresh }))
      yield* request(
        '/api/scm/pulls/detail',
        { repositoryId, number, refresh },
        pullDetailSchema,
      ).pipe(
        Effect.tap((value) =>
          Effect.sync(() => setState((current) => ({ ...current, detail: value, error: '' }))),
        ),
        Effect.flatMap((value) =>
          (readCache ? readCache.writeEffect(cacheKey, value) : Effect.void).pipe(
            Effect.catchAll(() =>
              Effect.sync(() => {
                if (!stopped) setError('Details loaded, but could not be saved for offline use.')
              }),
            ),
          ),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            if (!stopped) setState((current) => ({ ...current, busy: false, refreshing: false }))
          }),
        ),
      )
    })
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
  }, [repositoryId, number, cacheKey, connected, request, readCache, state.revision])
  const refresh = () => {
    if (!connected) return
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
    detail: state.detail,
    error: state.error,
    setError,
    busy: state.busy,
    refreshing: state.refreshing,
    refresh,
    invalidate,
  }
}
