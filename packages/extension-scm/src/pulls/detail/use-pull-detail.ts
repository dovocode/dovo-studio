import { readPullDetail } from '@dovo/studio-core/pull-reads'
import { pullDetailReadSchema, pullSectionInterval } from '@dovo/protocol'
import {
  combinePullSections,
  matchingPullSection,
  pullRevision,
  retainNewerPullSnapshot,
} from '@dovo/protocol'
import { useEffect, useRef, useMemo } from 'react'
import { Effect, Fiber } from 'effect'
import {
  startPolling,
  useWorkspace,
  useRepositorySources,
  type RepositorySource,
} from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import {
  guardedSourceRead,
  liveSourceReadGuard,
  useDetailReader,
  type SourceReadGuard,
} from '../../connections/source-readers'
import {
  pullDetailSchema,
  type PullDetailSection,
  forgeSourceIdentitySchema,
  RuntimeRequestError,
  type ForgeSourceIdentity,
  type PullDetail as Detail,
  type Workspace,
} from '@dovo/protocol'

type ReadTarget = {
  origin?: RepositorySource
  reader?: RepositorySource & { readerIdentity?: string }
  destination?: string
}
type WorkspaceRead = Pick<ReturnType<typeof useWorkspace>, 'requestEffect' | 'readCache'>
type SectionInput = {
  repositoryId: string
  number: number
  connectionId: string | undefined
  section: PullDetailSection
  revision?: string
}

/** Saved and in-memory keys for one section. Intent prefetch must use these exact keys. */
function pullSectionKeys(
  workspace: Workspace,
  { repositoryId, number, connectionId, section, revision }: SectionInput,
) {
  const repository = workspace.repositories.find((repo) => repo.id === repositoryId)
  const connection = connectionId ? ['connection', connectionId] : []
  return {
    cacheKey: JSON.stringify([
      'pulls',
      'detail-section',
      section,
      revision,
      repositoryId,
      repository?.path ?? '',
      number,
      repository?.forge,
      ...connection,
    ]),
    legacyCacheKey: JSON.stringify([
      'pulls',
      'detail',
      repositoryId,
      repository?.path ?? '',
      number,
      repository?.forge,
      ...connection,
    ]),
  }
}

/** One shared, conditional section read. A source reader reuses its live-verified account and
 * destination; the runtime rejects the read if either changed. Readers of the same section,
 * including intent prefetch, share the in-flight request and its live baseline. */
function readPullSection(
  { origin, reader, destination }: ReadTarget,
  { requestEffect: request, readCache }: WorkspaceRead,
  input: SectionInput & { cacheKey: string; refresh: boolean },
  urlGuard: SourceReadGuard = {},
) {
  const read = (readGuard: SourceReadGuard) =>
    readPullDetail(
      reader?.readCache ?? readCache ?? request,
      JSON.stringify([
        input.cacheKey,
        reader?.scope,
        reader?.readerIdentity,
        destination,
        readGuard,
      ]),
      (knownVersion) =>
        (reader?.requestEffect ?? request)(
          '/api/scm/pulls/detail',
          {
            repositoryId: reader?.repository.id ?? input.repositoryId,
            number: input.number,
            connectionId: input.connectionId,
            refresh: input.refresh,
            section: input.section,
            revision: input.revision,
            ...readGuard,
            conditional: true,
            knownVersion,
          },
          pullDetailReadSchema,
        ).pipe(
          Effect.map((value) =>
            !('unchanged' in value) && reader && reader.key !== origin?.key
              ? { ...value, destination, pull: { ...value.pull, destination } }
              : value,
          ),
        ),
      input.refresh,
    )
  return reader ? guardedSourceRead(reader, read) : read(urlGuard)
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
  // A failed identity lookup must not disable Retry on an online owning computer. Every
  // attempt still verifies the pinned account before requesting any PR data.
  const readConnected =
    reader && origin && reader.key === origin.key
      ? origin.connected
      : (reader?.connected ?? (!origin && connected))
  const { cacheKey, legacyCacheKey } = pullSectionKeys(workspace, {
    repositoryId,
    number,
    connectionId,
    section,
    revision,
  })
  const [state, setState, stateRef] = useApplicationState({
    scope: cacheKey,
    detail: null as Detail | null,
    error: '',
    busy: false,
    refreshing: false,
    revision: 0,
  })
  // A PR URL without a project pins the first verified account and destination for this detail.
  const urlIdentity = useRef<ForgeSourceIdentity | undefined>(undefined)
  const requestedRefresh = useRef(false)
  const savedDetail = useRef<{ key: string; value: Detail } | null>(null)
  const wasConnected = useRef(readConnected)
  const setError = (error: string) => setState((current) => ({ ...current, error }))
  useEffect(() => {
    urlIdentity.current = undefined
    setState((current) => ({ ...current, scope: cacheKey, detail: null, error: '' }))
  }, [cacheKey, readCache])
  useEffect(() => {
    let stopped = false
    setState((current) => ({ ...current, busy: false, refreshing: false }))
    const reconnected = readConnected && !wasConnected.current
    wasConnected.current = readConnected
    // Keep loaded sections available, but defer disk reads and owned polling workers
    // until their tab needs them. Enabling the section performs the initial read.
    if (!enabled) return
    let liveLoaded = false
    let liveFinished = false
    const hydrated = Effect.runSync(
      Effect.cached(
        Effect.gen(function* () {
          if (!readCache) return
          const cached =
            (yield* readCache.readEffect(cacheKey, pullDetailSchema)) ??
            (yield* readCache.readEffect(legacyCacheKey, pullDetailSchema))
          if (cached && !stopped && !liveLoaded)
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
              if (!stopped && !liveFinished)
                setError('Saved details could not be read from this device.')
            }),
          ),
        ),
      ),
    )
    let changesLoaded = false
    let force = reconnected
    const hydration = Effect.runFork(hydrated)
    const load = Effect.gen(function* () {
      if (!enabled || !readConnected || document.visibilityState !== 'visible') return
      const showRefresh = requestedRefresh.current
      const refresh = force || showRefresh
      force = false
      requestedRefresh.current = false
      // A successful diff pinned to both commit hashes cannot change. Overview polling
      // discovers pushes; explicit refresh, reconnection and scope changes still revalidate.
      if (section === 'changes' && changesLoaded && !refresh) return
      setState((current) => {
        const busy = !current.detail || showRefresh
        const refreshing = refresh && showRefresh
        return current.busy === busy && current.refreshing === refreshing
          ? current
          : { ...current, busy, refreshing }
      })
      // Only the first read of a PR URL needs a lookup. Later reads send the pinned account, and
      // the runtime rejects them if it changed; the pin itself never moves to another account.
      const identity =
        !reader && !origin && repositoryId.startsWith('http') && !urlIdentity.current
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
      if (identity && !stopped && !urlIdentity.current) urlIdentity.current = identity
      const pinned = urlIdentity.current ?? identity
      yield* readPullSection(
        { origin, reader, destination },
        { requestEffect: request, readCache },
        { repositoryId, number, connectionId, section, revision, cacheKey, refresh },
        pinned
          ? {
              expectedReaderIdentity: pinned.readerIdentity,
              expectedDestination: pinned.destination,
            }
          : {},
      ).pipe(
        Effect.mapError((error) =>
          !reader && pinned && error instanceof RuntimeRequestError && error.status === 409
            ? new RuntimeRequestError({
                kind: 'request',
                status: 409,
                message:
                  'The PR account or destination changed. Choose its source explicitly before refreshing.',
                cause: error,
              })
            : error,
        ),
        Effect.map((value) =>
          retainNewerPullSnapshot(stateRef.current.detail ?? undefined, value, refresh),
        ),
        Effect.tap((value) =>
          Effect.sync(() => {
            if (!stopped) {
              liveLoaded = true
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
              setState((current) =>
                current.detail === value && current.error === (value.refreshError ?? '')
                  ? current
                  : { ...current, detail: value, error: value.refreshError ?? '' },
              )
            }
          }),
        ),
        Effect.flatMap((value) =>
          (readCache &&
          (savedDetail.current?.key !== cacheKey || savedDetail.current.value !== value)
            ? readCache.writeEffect(cacheKey, value).pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    savedDetail.current = { key: cacheKey, value }
                  }),
                ),
              )
            : Effect.void
          ).pipe(
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
          liveFinished = true
          if (!stopped)
            setState((current) =>
              current.busy || current.refreshing
                ? { ...current, busy: false, refreshing: false }
                : current,
            )
        }),
      ),
    )
    const polling = startPolling(load, {
      interval: () =>
        stateRef.current.error ? 60_000 : pullSectionInterval(section, stateRef.current.detail),
      backoff: 120_000,
      enabled: () => readConnected && document.visibilityState === 'visible',
      onError: (error) => {
        if (!stopped)
          setState((current) => ({
            ...current,
            error: error.message,
            detail: current.detail ? { ...current.detail, stale: true } : null,
          }))
      },
    })
    const resume = () => {
      if (document.visibilityState !== 'visible') return
      force = true
      polling.refresh()
    }
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('focus', resume)
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('focus', resume)
      Effect.runFork(Fiber.interrupt(hydration))
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
    requestedRefresh.current = true
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
        ? 'The selected PR account is unavailable or changed. Choose its source explicitly; no other computer will take over.'
        : ''),
    setError,
    busy: state.busy,
    refreshing: state.refreshing,
    refresh,
    invalidate,
  }
}

/** The origin, reader and destination for one PR. Detail and intent prefetch both use this, so
 * they agree on the owning computer, account and destination. */
function usePullReadTarget(
  repositoryId: string,
  number: number,
  connectionId: string | undefined,
  discover: boolean,
): ReadTarget {
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
    discover,
  )
  return { origin, ...selected }
}

/** Warm the overview that the detail reads first, so a later click can join or reuse it. This uses
 * the detail's exact owner, cache key, account and destination. It reads only when live discovery
 * has already verified the account, sends at most one request, never polls and writes nothing to
 * disk. Unmounting stops only this waiter: the request is shared with any detail that joined it, so
 * it is not cancelled and finishes once into the bounded in-memory cache. Discussion, diffs and
 * other sections stay with the opened detail. */
export function usePullOverviewPrefetch(repositoryId: string, number: number) {
  const { requestEffect, readCache, workspace } = useWorkspace()
  // The list already discovers these sources; prefetch must not add identity lookups.
  const { origin, reader, destination } = usePullReadTarget(repositoryId, number, undefined, false)
  const input: SectionInput = { repositoryId, number, connectionId: undefined, section: 'overview' }
  const { cacheKey } = pullSectionKeys(workspace, input)
  useEffect(() => {
    if (
      !origin ||
      !reader?.connected ||
      reader.key !== origin.key ||
      !liveSourceReadGuard(reader) ||
      document.visibilityState !== 'visible'
    )
      return
    const fiber = Effect.runFork(
      readPullSection(
        { origin, reader, destination },
        { requestEffect, readCache },
        { ...input, cacheKey, refresh: false },
      ).pipe(Effect.ignore),
    )
    return () => {
      // Stop waiting only. The shared HTTP read is not cancelled; a joined detail may still need it.
      Effect.runFork(Fiber.interrupt(fiber))
    }
  }, [cacheKey, origin?.key, reader, destination, requestEffect, readCache])
}

export function usePullDetail(
  repositoryId: string,
  number: number,
  connectionId?: string,
  options: { tab?: string; discussionInOverview?: boolean } = {},
) {
  const target = usePullReadTarget(repositoryId, number, connectionId, true)
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
    // The header and merge dialog use this same report set on every tab. Keep it
    // current so opening Checks cannot change the meaning of the summary.
    available,
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
  const detail = useMemo(
    () =>
      combinePullSections(overview.detail, {
        status: status.detail,
        discussion: discussion.detail,
        changes: changes.detail,
        checks: checks.detail,
        stack: stack.enabled ? stack.detail : null,
      }),
    [
      overview.detail,
      status.detail,
      discussion.detail,
      changes.detail,
      checks.detail,
      stack.enabled,
      stack.detail,
    ],
  )
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
