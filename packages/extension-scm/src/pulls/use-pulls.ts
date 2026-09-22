import { useEffect, useRef, useState } from 'react'
import {
  pullPageSchema,
  useRepositorySources,
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
  const [stored, setStored] = useState<Record<string, Page>>({})
  const pageRef = useRef(stored)
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const forceNext = useRef(false)
  const generation = useRef(0)
  const inFlight = useRef<number | null>(null)
  const lastState = useRef(state)
  const remoteState = state === 'merged' ? 'closed' : state
  const update = (source: RepositorySource, page: PullPage, error?: string) => {
    pageRef.current = { ...pageRef.current, [source.key]: { ...page, source, error } }
    setStored(pageRef.current)
  }
  useEffect(() => {
    const current = ++generation.current
    pageRef.current = Object.fromEntries(
      Object.entries(pageRef.current).filter(
        ([key, page]) =>
          lastState.current === remoteState &&
          sources.some((source) => source.key === key && source.scope === page.source.scope),
      ),
    )
    lastState.current = remoteState
    setStored(pageRef.current)
    const hydrated = Promise.all(
      sources.map(async (source) => {
        if (pageRef.current[source.key]) return
        try {
          const cached = await source.readCache.read(cacheKey(source, remoteState), pullPageSchema)
          if (cached && current === generation.current && !pageRef.current[source.key])
            update(source, {
              ...cached.value,
              stale: true,
              cachedAt: cached.value.cachedAt ?? cached.cachedAt,
            })
        } catch {
          if (current === generation.current)
            update(
              source,
              { pulls: [], page: 0, hasMore: false },
              'Saved PRs could not be read from this device.',
            )
        }
      }),
    )
    setBusy(sources.some((source) => source.connected))
    inFlight.current = null
    const load = async (force = false) => {
      if (inFlight.current === current || current !== generation.current) return
      inFlight.current = current
      setBusy(sources.some((source) => source.connected))
      await hydrated
      const online = sources.filter((source) => source.connected)
      for (let i = 0; i < online.length && current === generation.current; i += 3)
        await Promise.all(
          online.slice(i, i + 3).map(async (source) => {
            try {
              const count = force ? 1 : Math.max(1, pageRef.current[source.key]?.page ?? 1)
              let page: PullPage = { pulls: [], page: 0, hasMore: true }
              for (let number = 1; number <= count && page.hasMore; number++) {
                const response = await source.request(
                  '/api/scm/pulls/overview',
                  {
                    repositoryId: source.repository.id,
                    state: remoteState,
                    page: number,
                    refresh: force,
                  },
                  pullPageSchema,
                )
                if (current !== generation.current) return
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
              try {
                await source.readCache.write(cacheKey(source, remoteState), page)
              } catch {
                if (current === generation.current)
                  update(source, page, 'PRs loaded, but could not be saved for offline use.')
              }
            } catch (error) {
              if (current === generation.current)
                update(
                  source,
                  {
                    ...(pageRef.current[source.key] ?? { pulls: [], page: 0, hasMore: false }),
                    stale: true,
                  },
                  String(error),
                )
            }
          }),
        )
      if (current === generation.current) setBusy(false)
      if (inFlight.current === current) inFlight.current = null
    }
    const force = forceNext.current
    forceNext.current = false
    void load(force)
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 30000)
    return () => {
      clearInterval(timer)
      generation.current++
    }
  }, [sources, remoteState, revision])
  const refresh = () => {
    forceNext.current = true
    setRevision((value) => value + 1)
  }
  const more = async (key: string) => {
    const previous = pageRef.current[key],
      current = generation.current
    const source = sources.find((source) => source.key === key)
    if (!previous || !source?.connected || inFlight.current === current) return
    if (previous.error) {
      refresh()
      return
    }
    inFlight.current = current
    setBusy(true)
    try {
      const next = await source.request(
        '/api/scm/pulls/overview',
        { repositoryId: source.repository.id, state: remoteState, page: previous.page + 1 },
        pullPageSchema,
      )
      if (current !== generation.current) return
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
      try {
        await source.readCache.write(cacheKey(source, remoteState), page)
      } catch {
        if (current === generation.current)
          update(source, page, 'PRs loaded, but could not be saved for offline use.')
      }
    } catch (error) {
      if (current === generation.current) update(source, previous, String(error))
    } finally {
      if (current === generation.current) {
        setBusy(false)
        inFlight.current = null
      }
    }
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
    more,
    refresh,
  }
}
