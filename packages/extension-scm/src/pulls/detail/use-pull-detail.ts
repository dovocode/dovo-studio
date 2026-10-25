import {
  combinePullSections,
  matchingPullSection,
  pullRevision,
  retainNewerPullSnapshot,
} from '@dovo/protocol'
import { useEffect, useRef } from 'react'
import { Effect } from 'effect'
import {
  startPolling,
  useWorkspace,
  useRepositorySources,
  type RepositorySource,
} from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import { useDetailReader, verifySourceReader } from '../../connections/source-readers'
import {
  pullDetailSchema,
  type PullDetailSection,
  forgeSourceIdentitySchema,
  RuntimeRequestError,
  type PullDetail as Detail,
} from '@dovo/protocol'

type ReadTarget = {
  origin?: RepositorySource
  reader?: RepositorySource & { readerIdentity?: string }
  destination?: string
}

function usePullSection(
  { origin, reader, destination }: ReadTarget,
  repositoryId: string,
  number: number,
  connectionId: string | undefined,
  section: PullDetailSection,
  enabled: boolean,
  revision?: string,
) {
  const { requestEffect: request, connected, workspace, readCache } = useWorkspace()
  const readConnected = reader?.connected ?? (!origin && connected)
  const repository = workspace.repositories.find((repo) => repo.id === repositoryId)
  const cacheKey = JSON.stringify([
    'pulls',
    'detail-section',
    section,
    revision,
    repositoryId,
    repository?.path ?? '',
    number,
    repository?.forge,
    ...(connectionId ? ['connection', connectionId] : []),
  ])
  const legacyCacheKey = JSON.stringify([
    'pulls',
    'detail',
    repositoryId,
    repository?.path ?? '',
    number,
    repository?.forge,
    ...(connectionId ? ['connection', connectionId] : []),
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
  const urlIdentity = useRef<string | undefined>(undefined)
  const setError = (error: string) => setState((current) => ({ ...current, error }))
  useEffect(() => {
    urlIdentity.current = undefined
    setState((current) => ({ ...current, scope: cacheKey, detail: null, error: '' }))
  }, [cacheKey, readCache])
  useEffect(() => {
    let stopped = false
    setState((current) => ({ ...current, busy: false, refreshing: false }))
    // Keep loaded sections available, but defer disk reads and owned polling workers
    // until their tab needs them. Enabling the section performs the initial read.
    if (!enabled) return
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
    let changesLoaded = false
    let force = forceNext.current
    forceNext.current = false
    const load = Effect.gen(function* () {
      yield* hydrated
      if (!enabled || !readConnected || document.visibilityState !== 'visible') return
      const refresh = force
      force = false
      // A successful diff pinned to both commit hashes cannot change. Overview polling
      // discovers pushes; explicit refresh, reconnection and scope changes still revalidate.
      if (section === 'changes' && changesLoaded && !refresh) return
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
          section,
          revision,
          ...readGuard,
        },
        pullDetailSchema,
      ).pipe(
        Effect.map((value) =>
          reader && reader.key !== origin?.key
            ? { ...value, destination, pull: { ...value.pull, destination } }
            : value,
        ),
        Effect.map((value) => retainNewerPullSnapshot(stateRef.current.detail ?? undefined, value)),
        Effect.tap((value) =>
          Effect.sync(() => {
            if (!stopped) {
              changesLoaded = !!(
                section === 'changes' &&
                revision &&
                value.pull.headSha &&
                value.pull.baseSha &&
                pullRevision(value) === revision &&
                !value.stale &&
                !value.refreshError &&
                !value.warnings.length
              )
              setState((current) => ({
                ...current,
                detail: value,
                error: value.refreshError ?? '',
              }))
            }
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
        if (!stopped)
          setState((current) => ({
            ...current,
            error: error.message,
            detail: current.detail ? { ...current.detail, stale: true } : null,
          }))
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
    section,
    revision,
    enabled,
    cacheKey,
    legacyCacheKey,
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
      .then(() => readCache.remove(legacyCacheKey))
      .catch(() =>
        setError('Saved details could not be cleared. Refresh to load the latest discussion.'),
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
    error:
      state.error ||
      (origin?.connected && !reader
        ? 'The selected PR account is unavailable or changed. Choose its source explicitly; no other machine will take over.'
        : ''),
    setError,
    busy: state.busy,
    refreshing: state.refreshing,
    refresh,
    invalidate,
  }
}

export function usePullDetail(
  repositoryId: string,
  number: number,
  connectionId?: string,
  options: { tab?: string; discussionInOverview?: boolean } = {},
) {
  const { activeRuntimeId } = useWorkspace()
  const sources = useRepositorySources()
  const origin = sources.find(
    (source) => source.runtimeId === activeRuntimeId && source.repository.id === repositoryId,
  )
  const selected = useDetailReader(
    origin,
    sources,
    JSON.stringify([repositoryId, number, connectionId]),
    undefined,
    false,
  )
  const target = { origin, ...selected }
  const tab = options.tab ?? 'overview'
  const overview = usePullSection(target, repositoryId, number, connectionId, 'overview', true)
  const revision = overview.detail ? pullRevision(overview.detail) : undefined
  const available = !!overview.detail
  const status = usePullSection(
    target,
    repositoryId,
    number,
    connectionId,
    'status',
    available,
    revision,
  )
  const discussion = usePullSection(
    target,
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
    target,
    repositoryId,
    number,
    connectionId,
    'changes',
    available && tab === 'changes',
    revision,
  )
  const checks = usePullSection(
    target,
    repositoryId,
    number,
    connectionId,
    'checks',
    available && tab === 'checks',
    revision,
  )
  const stack = usePullSection(
    target,
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
