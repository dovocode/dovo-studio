import { runClientEffect } from '@dovo/client-runtime'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import {
  runtimeResourceKey,
  taskSearchHitLimit,
  taskSearchSchema,
  type TaskSearchResult,
  type TaskSearchScope,
  type RuntimeOverview,
} from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { useAppActive } from '../../runtime/state/app-active'

// Stream chunks update updatedAt. Observe committed input, structural history changes and
// turn boundaries while running; idle edits also change updatedAt without a new turn.
const historySignature = (entry: RuntimeOverview) =>
  entry.snapshot?.workspace.tasks.map((task) => {
    const turn = task.turns?.at(-1)
    return [
      task.id,
      task.historyRevision,
      task.lastPromptAt,
      task.status,
      turn?.id,
      turn?.status,
      turn?.finishedAt,
      task.status === 'running' ? undefined : task.updatedAt,
    ]
  })

type ComputerSearch = {
  /** Query, connection and scope. Results stay visible while only history changes. */
  base: string
  /** `base` plus the computer's history signature for the last completed request. */
  request?: string
  result?: TaskSearchResult
  error?: string
}

/**
 * Search history on each owning computer; snapshots deliberately omit conversation bodies.
 * Each computer keeps its own results, and a history change refreshes only that computer.
 * `scopes` limits which threads on a computer can supply message hits. When given, only the
 * computers it lists are searched. Older runtimes without `taskSearchScopeSupported` receive no
 * scope; the caller filters their hits.
 */
export function useTaskSearch(
  entries: readonly RuntimeOverview[],
  query: string,
  enabled = true,
  scopes?: Readonly<Record<string, TaskSearchScope>>,
) {
  const { readRuntimeEffect } = useRuntime()
  const active = useAppActive() && enabled
  const needle = query.trim().toLowerCase()
  // History signatures are built only while a query is active.
  const wanted = needle
    ? entries
        .filter((entry) => entry.connected && (!scopes || Object.hasOwn(scopes, entry.profile.id)))
        .map((entry) => {
          const scoped = !!entry.snapshot?.taskSearchScopeSupported
          const base = JSON.stringify([
            needle,
            entry.profile.connection,
            (scoped && scopes?.[entry.profile.id]) || null,
          ])
          return {
            id: entry.profile.id,
            query: needle,
            scoped,
            base,
            request: JSON.stringify([base, historySignature(entry)]),
          }
        })
    : []
  const wantedKey = JSON.stringify(wanted)
  const [searches, setSearches] = useState<Readonly<Record<string, ComputerSearch>>>({})
  const inFlight = useRef(new Map<string, { request: string; controller: AbortController }>())
  const read = useEffectEvent(readRuntimeEffect)
  const profile = useEffectEvent(
    (id: string) => entries.find((entry) => entry.profile.id === id)?.profile,
  )
  const completed = useEffectEvent((id: string) => searches[id]?.request)
  const scopeFor = useEffectEvent((id: string) => scopes?.[id])
  useEffect(() => {
    const requests: typeof wanted = JSON.parse(wantedKey)
    const current = new Map(requests.map((item) => [item.id, item.request]))
    // Abort reads for computers whose request changed, left or paused.
    for (const [id, flight] of inFlight.current)
      if (!active || current.get(id) !== flight.request) {
        flight.controller.abort()
        inFlight.current.delete(id)
      }
    // Retry a failed request when it becomes active again. Keep any earlier results.
    setSearches((searches) => {
      let next: Record<string, ComputerSearch> | undefined
      for (const [id, search] of Object.entries(searches)) {
        if (!search.error || (active && current.get(id) === search.request)) continue
        next ??= { ...searches }
        next[id] = { base: search.base, result: search.result }
      }
      return next ?? searches
    })
    if (!active || !requests.length) return
    const timer = setTimeout(() => {
      for (const { id, query, scoped, base, request } of requests) {
        if (inFlight.current.get(id)?.request === request || completed(id) === request) continue
        const owner = profile(id)
        if (!owner) continue
        const controller = new AbortController()
        inFlight.current.set(id, { request, controller })
        const scope = scoped ? scopeFor(id) : undefined
        const settle = (outcome: Pick<ComputerSearch, 'result' | 'error'>) => {
          if (controller.signal.aborted) return
          if (inFlight.current.get(id)?.controller === controller) inFlight.current.delete(id)
          setSearches((searches) => {
            // A failed refresh keeps this computer's previous results for the same query.
            const previous = searches[id]?.base === base ? searches[id].result : undefined
            return {
              ...searches,
              [id]: {
                base,
                request,
                result: outcome.result ?? previous,
                ...(outcome.error ? { error: outcome.error } : {}),
              },
            }
          })
        }
        void runClientEffect(
          read(
            owner,
            '/api/tasks/search',
            { query, ...(scope ? { scope } : {}) },
            taskSearchSchema,
          ),
          controller.signal,
        ).then(
          (result) => settle({ result }),
          (error: unknown) =>
            settle({
              error: `${owner.name}: ${error instanceof Error ? error.message : String(error)}`,
            }),
        )
      }
    }, 200)
    return () => clearTimeout(timer)
  }, [wantedKey, active])
  useEffect(
    () => () => {
      for (const flight of inFlight.current.values()) flight.controller.abort()
      inFlight.current.clear()
    },
    [],
  )
  const visible = wanted.flatMap(({ id, base }) => {
    const search = searches[id]
    return search?.base === base ? [{ runtimeId: id, search }] : []
  })
  const results = visible.flatMap(({ runtimeId, search }) =>
    search.result ? [{ runtimeId, result: search.result }] : [],
  )
  return {
    hits: results.flatMap(({ runtimeId, result }) =>
      result.hits.map((hit) => ({
        ...hit,
        runtimeId,
        key: runtimeResourceKey(runtimeId, hit.taskId),
      })),
    ),
    keys: new Set(
      results.flatMap(({ runtimeId, result }) =>
        result.taskIds.map((id) => runtimeResourceKey(runtimeId, id)),
      ),
    ),
    loading: active && wanted.some(({ id, request }) => searches[id]?.request !== request),
    error: visible.flatMap(({ search }) => (search.error ? [search.error] : [])).join(' · '),
    /** Computers that cannot apply `scopes` and returned a full page of hits. Filtering that
     * page locally can omit matching messages. */
    unscopedFull: results.flatMap(({ runtimeId, result }) => {
      const entry = entries.find((item) => item.profile.id === runtimeId)
      return entry &&
        !entry.snapshot?.taskSearchScopeSupported &&
        scopes?.[runtimeId] &&
        result.hits.length >= taskSearchHitLimit
        ? [entry.profile.name]
        : []
    }),
    offline: !!needle && entries.some((entry) => !entry.connected),
  }
}
