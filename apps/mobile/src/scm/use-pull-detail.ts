import { useEffect, useRef } from 'react'
import { Effect } from 'effect'
import { startPolling, runClientEffect } from '@dovo/client-runtime'
import { useRuntime } from '../runtime/provider'
import { useApplicationState } from '../runtime/application-state'
import { pullDetailSchema, type PullDetail as Detail } from '@dovo/protocol'
import { AppState } from 'react-native'
import { useNavigation } from '../shell/navigation'

export function usePullDetail(repositoryId: string, number: number) {
  const { focused } = useNavigation()
  const { readEffect: request, connected, snapshot, readCache } = useRuntime()
  const repository = snapshot?.workspace.repositories.find((repo) => repo.id === repositoryId)
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
      if (!connected || !focused || AppState.currentState !== 'active') return
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
    return () => {
      stopped = true
      void polling.stop()
    }
  }, [repositoryId, number, cacheKey, connected, request, readCache, state.revision, focused])
  const refresh = () => {
    if (!connected || !focused) return
    forceNext.current = true
    setState((current) => ({ ...current, refreshing: true, revision: current.revision + 1 }))
  }
  const invalidate = () => {
    if (readCache)
      void runClientEffect(
        readCache
          .removeEffect(cacheKey)
          .pipe(
            Effect.catchAll(() =>
              Effect.sync(() =>
                setError(
                  'Saved details could not be cleared. Refresh to load the latest discussion.',
                ),
              ),
            ),
          ),
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
