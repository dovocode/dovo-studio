import {
  combinePullSections,
  matchingPullSection,
  pullRevision,
  retainNewerPullSnapshot,
} from '@dovo/protocol'
import { useEffect, useRef } from 'react'
import { Effect } from 'effect'
import { startPolling, runClientEffect } from '@dovo/client-runtime'
import { useSourceReader } from '../../source-reader'
import { useRuntime } from '../../../runtime/connection/provider'
import { useApplicationState } from '../../../runtime/state/application-state'
import { pullDetailSchema, type PullDetailSection, type PullDetail as Detail } from '@dovo/protocol'
import { AppState } from 'react-native'
import { useNavigation } from '../../../shell/navigation'

function usePullSection(
  reader: ReturnType<typeof useSourceReader>,
  repositoryId: string,
  number: number,
  connectionId: string | undefined,
  section: PullDetailSection,
  enabled: boolean,
  revision?: string,
) {
  const { focused } = useNavigation()
  const { connected, snapshot, readCache } = useRuntime()
  const { readEffect: request, acceptCurrentAccount: acceptReader } = reader
  const readConnected = connected
  const repository = snapshot?.workspace.repositories.find((repo) => repo.id === repositoryId)
  const cacheKey = JSON.stringify([
    'pulls',
    'detail-section',
    section,
    revision,
    repositoryId,
    repository?.path ?? '',
    number,
    repository?.forge,
    connectionId,
  ])
  const legacyCacheKey = JSON.stringify([
    'pulls',
    'detail',
    repositoryId,
    repository?.path ?? '',
    number,
    repository?.forge,
    connectionId,
  ])
  const [state, setState, stateRef] = useApplicationState({
    scope: cacheKey,
    detail: null as Detail | null,
    error: '',
    busy: false,
    refreshing: false,
    revision: 0,
  })
  const forceNext = useRef(false)
  const setError = (error: string) => setState((current) => ({ ...current, error }))
  useEffect(() => {
    setState((current) => ({ ...current, scope: cacheKey, detail: null, error: '' }))
  }, [cacheKey, readCache])
  useEffect(() => {
    let stopped = false
    const hydrated = Effect.runSync(
      Effect.cached(
        Effect.gen(function* () {
          if (!readCache) return
          const cached =
            (yield* readCache.readEffect(cacheKey, pullDetailSchema)) ??
            (yield* readCache.readEffect(legacyCacheKey, pullDetailSchema))
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
    if (enabled) forceNext.current = false
    setState((current) => ({ ...current, busy: false, refreshing: false }))
    const load = Effect.gen(function* () {
      yield* hydrated
      if (!enabled || !readConnected || !focused || AppState.currentState !== 'active') return
      const refresh = force
      force = false
      setState((current) => ({ ...current, busy: true, refreshing: refresh }))
      yield* request(
        '/api/scm/pulls/detail',
        { repositoryId, number, connectionId, refresh, section, revision },
        pullDetailSchema,
      ).pipe(
        Effect.map((value) => retainNewerPullSnapshot(stateRef.current.detail ?? undefined, value)),
        Effect.tap((value) =>
          Effect.sync(() => {
            if (!stopped)
              setState((current) => ({
                ...current,
                detail: value,
                error: value.refreshError ?? '',
              }))
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
        if (!stopped)
          setState((current) => ({
            ...current,
            error: error.message,
            detail: current.detail ? { ...current.detail, stale: true } : null,
          }))
      },
    })
    return () => {
      stopped = true
      void polling.stop()
    }
  }, [
    repositoryId,
    number,
    cacheKey,
    legacyCacheKey,
    readConnected,
    request,
    readCache,
    state.revision,
    focused,
    enabled,
    section,
    revision,
  ])
  const refresh = () => {
    if (!readConnected || !focused) return
    forceNext.current = true
    setState((current) => ({ ...current, refreshing: true, revision: current.revision + 1 }))
  }
  const invalidate = () => {
    if (readCache)
      void runClientEffect(
        readCache.removeEffect(cacheKey).pipe(
          Effect.andThen(readCache.removeEffect(legacyCacheKey)),
          Effect.catch(() =>
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
    enabled,
    ready: !!(state.scope === cacheKey && state.detail),
    readConnected,
    detail:
      state.scope === cacheKey && state.detail
        ? readConnected
          ? state.detail
          : { ...state.detail, stale: true }
        : null,
    error: state.error,
    setError,
    busy: state.busy,
    refreshing: state.refreshing,
    refresh,
    invalidate,
    acceptCurrentAccount: () => {
      if (!connected) return
      void runClientEffect(
        (readCache
          ? readCache
              .removeEffect(cacheKey)
              .pipe(Effect.andThen(readCache.removeEffect(legacyCacheKey)))
          : Effect.void
        ).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              acceptReader()
              setState((current) => ({
                ...current,
                detail: null,
                error: '',
                revision: current.revision + 1,
              }))
            }),
          ),
          Effect.catch((error) => Effect.sync(() => setError(error.message))),
        ),
      )
    },
  }
}

export function usePullDetail(
  repositoryId: string,
  number: number,
  connectionId?: string,
  options: { tab?: string; discussionInOverview?: boolean } = {},
) {
  const reader = useSourceReader(repositoryId, undefined, connectionId)
  const tab = options.tab ?? 'overview'
  const overview = usePullSection(reader, repositoryId, number, connectionId, 'overview', true)
  const revision = overview.detail ? pullRevision(overview.detail) : undefined
  const available = !!overview.detail
  const status = usePullSection(
    reader,
    repositoryId,
    number,
    connectionId,
    'status',
    available,
    revision,
  )
  const discussion = usePullSection(
    reader,
    repositoryId,
    number,
    connectionId,
    'discussion',
    available &&
      (tab === 'discussion' ||
        tab === 'checks' ||
        tab === 'changes' ||
        (tab === 'overview' && !!options.discussionInOverview)),
    revision,
  )
  const changes = usePullSection(
    reader,
    repositoryId,
    number,
    connectionId,
    'changes',
    available && tab === 'changes',
    revision,
  )
  const checks = usePullSection(
    reader,
    repositoryId,
    number,
    connectionId,
    'checks',
    available && tab === 'checks',
    revision,
  )
  const stack = usePullSection(
    reader,
    repositoryId,
    number,
    connectionId,
    'stack',
    available && overview.detail?.pull.state === 'open' && !repositoryId.startsWith('http'),
    revision,
  )
  const current = (section: typeof overview) => ({
    ...section,
    ready: matchingPullSection(overview.detail, section.detail),
  })
  const sections = {
    overview,
    status: current(status),
    discussion: current(discussion),
    changes: current(changes),
    checks: current(checks),
    stack: current(stack),
  }
  const detail = combinePullSections(overview.detail, {
    status: status.detail,
    discussion: discussion.detail,
    changes: changes.detail,
    checks: checks.detail,
    stack: stack.enabled ? stack.detail : null,
  })
  // A section can discover a push before the overview's cache expires. Refresh the overview once
  // for that discovered revision; never attach the mismatched comments or diff in the meantime.
  const discovered = [status, discussion, changes, checks, stack]
    .map((value) => value.detail)
    .find((value) => value && overview.detail && !matchingPullSection(overview.detail, value))
  const discoveredRevision = discovered ? pullRevision(discovered) : undefined
  const lastDiscovered = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (discoveredRevision && discoveredRevision !== lastDiscovered.current) {
      lastDiscovered.current = discoveredRevision
      overview.refresh()
    }
  }, [discoveredRevision])
  const active =
    tab === 'changes'
      ? changes
      : tab === 'checks'
        ? checks
        : tab === 'discussion'
          ? discussion
          : overview
  return {
    ...overview,
    detail,
    sections,
    refreshing: overview.refreshing || active.refreshing,
    refresh: () => {
      for (const section of Object.values(sections)) if (section.enabled) section.refresh()
    },
    invalidate: () => {
      for (const section of Object.values(sections)) section.invalidate()
    },
  }
}
