import { useEffect, useRef, useState } from 'react'
import { pullPageSchema, type PullPage } from '@dovo/protocol'
import { z } from 'zod'
import { refreshFirstPage } from './collection-pages'
import { useRuntime } from '../runtime/provider'
import {
  collectionSources,
  collectionSourceIdentity,
  projectContentIdentity,
} from '../runtime/collection-sources'
import { AppState } from 'react-native'
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
const cachedPullPageSchema = pullPageSchema.extend({ firstPageIds: z.array(z.string()).optional() })
type Repository = { id: string; name: string; path: string; forge?: unknown }
const cacheKey = (repository: Repository, state: string) =>
  JSON.stringify(['pulls', 'list', repository.id, repository.path, state, repository.forge])

export function usePulls(repositoryId: string, state: string) {
  const { focused: enabled } = useNavigation()
  const { readRuntime: request, overviews, cacheForRuntime } = useRuntime()
  const sources = collectionSources(overviews).filter(
    (source) => !repositoryId || source.key === repositoryId,
  )
  const key = collectionSourceIdentity(sources)
  const sourcesRef = useRef(sources)
  sourcesRef.current = sources
  const connected = sources.some((source) => source.connected)
  const [pages, setPages] = useState<Record<string, Page>>({})
  const pageRef = useRef(pages)
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const forceNext = useRef(false)
  const source = useRef<string>('')
  const generation = useRef(0)
  const inFlight = useRef<number | null>(null)
  const remoteState = state === 'merged' ? 'closed' : state
  const update = (id: string, page: Page) => {
    pageRef.current = { ...pageRef.current, [id]: page }
    setPages(pageRef.current)
  }
  useEffect(() => {
    const current = ++generation.current
    const repositories = sourcesRef.current
    const currentSources = new Map(repositories.map((entry) => [entry.key, entry]))
    pageRef.current =
      source.current !== remoteState
        ? {}
        : Object.fromEntries(
            Object.entries(pageRef.current).filter(([id, page]) => {
              const entry = currentSources.get(id)
              return entry && page.sourceIdentity === projectContentIdentity(entry)
            }),
          )
    setPages(pageRef.current)
    source.current = remoteState
    const hydrated = Promise.all(
      repositories.map(async (entry) => {
        const repo = entry.repository,
          readCache = cacheForRuntime(entry.profile)
        const metadata = {
          sourceKey: entry.key,
          sourceIdentity: projectContentIdentity(entry),
          runtimeId: entry.profile.id,
          runtimeName: entry.profile.name,
          connected: entry.connected,
        }
        try {
          const cached = await readCache.read(cacheKey(repo, remoteState), cachedPullPageSchema)
          if (cached && current === generation.current && !pageRef.current[entry.key])
            update(entry.key, {
              ...metadata,
              ...cached.value,
              repositoryId: repo.id,
              name: repo.name,
              stale: true,
              cachedAt: cached.value.cachedAt ?? cached.cachedAt,
            })
        } catch {
          if (current === generation.current && !pageRef.current[entry.key])
            update(entry.key, {
              ...metadata,
              pulls: [],
              page: 0,
              hasMore: false,
              repositoryId: repo.id,
              name: repo.name,
              error: 'Saved PRs could not be read from this device.',
            })
        }
      }),
    )
    setBusy(connected && enabled)
    let loading = false
    const load = async (force = false) => {
      if (
        loading ||
        inFlight.current === current ||
        current !== generation.current ||
        !connected ||
        !enabled
      )
        return
      inFlight.current = current
      loading = true
      await hydrated
      for (let i = 0; i < repositories.length && current === generation.current; i += 3)
        await Promise.all(
          repositories.slice(i, i + 3).map(async (entry) => {
            if (!entry.connected) return
            const repo = entry.repository,
              readCache = cacheForRuntime(entry.profile)
            const metadata = {
              sourceKey: entry.key,
              sourceIdentity: projectContentIdentity(entry),
              runtimeId: entry.profile.id,
              runtimeName: entry.profile.name,
              connected: entry.connected,
            }
            try {
              const invalidated = pullListRevision(readCache, repo.id)
              const refresh = force || !!invalidated
              const response = await request(
                entry.profile,
                '/api/scm/pulls/overview',
                { repositoryId: repo.id, state: remoteState, page: 1, refresh },
                pullPageSchema,
              )
              if (current !== generation.current) return
              const previous = pageRef.current[entry.key]
              const page: Page = {
                ...metadata,
                ...response,
                repositoryId: repo.id,
                name: repo.name,
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
                        previous.firstPageIds ?? [],
                        response.pulls,
                        (pull) => String(pull.number),
                      ),
                    }
                  : {}),
              }
              update(entry.key, page)
              if (!response.stale && !response.refreshError)
                acknowledgePullList(readCache, repo.id, invalidated)
              try {
                await readCache?.write(
                  cacheKey(repo, remoteState),
                  cachedPullPageSchema.parse(page),
                )
              } catch {
                if (current === generation.current)
                  update(entry.key, {
                    ...metadata,
                    ...page,
                    error: 'PRs loaded, but could not be saved for offline use.',
                  })
              }
            } catch (error) {
              if (current === generation.current)
                update(entry.key, {
                  ...metadata,
                  ...(pageRef.current[entry.key] ?? { pulls: [], hasMore: false, page: 0 }),
                  repositoryId: repo.id,
                  name: repo.name,
                  stale: true,
                  error: String(error),
                })
            }
          }),
        )
      if (current === generation.current) setBusy(false)
      loading = false
      if (inFlight.current === current) inFlight.current = null
    }
    const force = forceNext.current
    forceNext.current = false
    void load(force)
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void load()
    }, 10000)
    return () => {
      clearInterval(timer)
      generation.current++
    }
  }, [key, remoteState, connected, request, cacheForRuntime, revision, enabled])
  const refresh = () => {
    forceNext.current = true
    setRevision((value) => value + 1)
  }
  const more = async (id: string) => {
    const previous = pageRef.current[id],
      current = generation.current
    const entry = sourcesRef.current.find((item) => item.key === id)
    if (!previous || !entry || busy || inFlight.current === current || !entry.connected || !enabled)
      return
    const repo = entry.repository,
      readCache = cacheForRuntime(entry.profile)
    if (previous.error) {
      refresh()
      return
    }
    inFlight.current = current
    setBusy(true)
    try {
      const next = await request(
        entry.profile,
        '/api/scm/pulls/overview',
        { repositoryId: repo.id, state: remoteState, page: previous.page + 1 },
        pullPageSchema,
      )
      if (current === generation.current) {
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
        try {
          await readCache?.write(cacheKey(repo, remoteState), cachedPullPageSchema.parse(page))
        } catch {
          if (current === generation.current)
            update(id, { ...page, error: 'PRs loaded, but could not be saved for offline use.' })
        }
      }
    } catch (error) {
      if (current === generation.current) update(id, { ...previous, error: String(error) })
    } finally {
      if (inFlight.current === current) inFlight.current = null
      if (current === generation.current) setBusy(false)
    }
  }
  const currentSources = new Map(sources.map((entry) => [entry.key, entry]))
  const values =
    source.current !== remoteState
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
  return { pages: values, sources, busy, connected, more, refresh }
}
