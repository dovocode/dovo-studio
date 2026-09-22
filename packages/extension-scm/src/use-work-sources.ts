import { useEffect, useRef, useState } from 'react'
import {
  forgeWorkOptionsSchema,
  forgeIssuePageSchema,
  forgePipelinePageSchema,
  type ForgeWorkOptions,
  type ForgeIssue,
  type ForgePipeline,
} from '@dovo/studio-core'

import { useIssueSources, type WorkSource } from './work-sources'

type Page = {
  loadedPages?: number
  query?: string
  source: WorkSource
  items: Array<ForgeIssue | ForgePipeline>
  options?: ForgeWorkOptions
  next?: string
  stale?: boolean
  error?: string
}
const cacheKey = (source: WorkSource, mode: string, kind: string, query = '') =>
  JSON.stringify([
    'work',
    source.input,
    source.repository?.path,
    source.repository?.forge,
    source.jira,
    mode,
    kind,
    undefined,
    kind === 'list' ? 'all' : undefined,
    kind === 'list' ? query || undefined : undefined,
  ])
export function useWorkSources(mode: 'issues' | 'pipelines', search = '') {
  const sources = useIssueSources(mode === 'issues')
  const [stored, setStored] = useState<Record<string, Page>>({})
  const pagesRef = useRef(stored)
  const generation = useRef(0)
  const inFlight = useRef<number | null>(null)
  const lastMode = useRef(mode)
  const lastSearch = useRef(search)
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const forceNext = useRef(false)
  const update = (source: WorkSource, page: Omit<Page, 'source'>) => {
    pagesRef.current = { ...pagesRef.current, [source.key]: { ...page, source } }
    setStored(pagesRef.current)
  }
  useEffect(() => {
    const current = ++generation.current
    pagesRef.current = Object.fromEntries(
      Object.entries(pagesRef.current).filter(
        ([key, page]) =>
          lastMode.current === mode &&
          lastSearch.current === search &&
          sources.some((source) => source.key === key && source.scope === page.source.scope),
      ),
    )
    lastMode.current = mode
    lastSearch.current = search
    setStored(pagesRef.current)
    const hydrated = Promise.all(
      sources.map(async (source) => {
        if (pagesRef.current[source.key]) return
        try {
          const [options, page] = await Promise.all([
            source.readCache.read(cacheKey(source, mode, 'options'), forgeWorkOptionsSchema),
            mode === 'issues'
              ? source.readCache.read(cacheKey(source, mode, 'list', search), forgeIssuePageSchema)
              : source.readCache.read(
                  cacheKey(source, mode, 'list', search),
                  forgePipelinePageSchema,
                ),
          ])
          if (current === generation.current && !pagesRef.current[source.key] && (options || page))
            update(source, {
              ...page?.value,
              items: page?.value.items ?? [],
              options: options?.value,
              stale: true,
              query: options?.value.issueSearch ? search : undefined,
            })
        } catch {
          if (current === generation.current)
            update(source, {
              items: [],
              error: 'Saved results could not be read from this device.',
            })
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
              const options = await source.request(
                '/api/scm/work/options',
                { ...source.input, area: mode },
                forgeWorkOptionsSchema,
              )
              if (current !== generation.current) return
              const query =
                mode === 'issues' &&
                options.issueSearch &&
                search &&
                !`${source.name} ${source.runtimeName}`.toLowerCase().includes(search.toLowerCase())
                  ? search
                  : undefined
              const supported = mode === 'issues' ? options.issues : options.pipelines
              const count = force ? 1 : Math.max(1, pagesRef.current[source.key]?.loadedPages ?? 1)
              let response: {
                items: Array<ForgeIssue | ForgePipeline>
                next?: string
                stale?: boolean
                refreshError?: string
              } = { items: [] }
              let loadedPages = 0
              if (supported)
                for (let number = 0; number < count; number++) {
                  const next =
                    mode === 'issues'
                      ? await source.request(
                          '/api/scm/work/issues/list',
                          {
                            ...source.input,
                            state: 'all',
                            query,
                            cursor: response.next,
                            refresh: force,
                          },
                          forgeIssuePageSchema,
                        )
                      : await source.request(
                          '/api/scm/work/pipelines/list',
                          {
                            ...source.input,
                            cursor: response.next,
                            refresh: force,
                          },
                          forgePipelinePageSchema,
                        )
                  if (current !== generation.current) return
                  response = {
                    ...next,
                    stale: response.stale || next.stale,
                    refreshError: response.refreshError || next.refreshError,
                    items: [
                      ...new Map(
                        [...response.items, ...next.items].map((item) => [item.id, item]),
                      ).values(),
                    ],
                  }
                  loadedPages++
                  if (!response.next) break
                }
              const page = {
                ...response,
                options,
                loadedPages,
                query,
                error: response.refreshError,
              }
              update(source, page)
              try {
                await source.readCache.write(cacheKey(source, mode, 'options'), options)
                await source.readCache.write(cacheKey(source, mode, 'list', search), response)
              } catch {
                if (current === generation.current)
                  update(source, {
                    ...page,
                    error: 'Results loaded, but could not be saved for offline use.',
                  })
              }
            } catch (error) {
              if (current === generation.current)
                update(source, {
                  ...(pagesRef.current[source.key] ?? { items: [] }),
                  stale: true,
                  error: String(error),
                })
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
  }, [sources, mode, revision, search])
  const refresh = () => {
    forceNext.current = true
    setRevision((value) => value + 1)
  }
  const more = async (key: string) => {
    const previous = pagesRef.current[key],
      current = generation.current
    const source = sources.find((source) => source.key === key)
    if (!previous?.next || inFlight.current === current || !source?.connected) return
    inFlight.current = current
    setBusy(true)
    try {
      const response =
        mode === 'issues'
          ? await source.request(
              '/api/scm/work/issues/list',
              {
                ...source.input,
                state: 'all',
                query: previous.query,
                cursor: previous.next,
              },
              forgeIssuePageSchema,
            )
          : await source.request(
              '/api/scm/work/pipelines/list',
              { ...source.input, cursor: previous.next },
              forgePipelinePageSchema,
            )
      if (current !== generation.current) return
      const items = [
        ...new Map([...previous.items, ...response.items].map((row) => [row.id, row])).values(),
      ]
      const page = {
        ...previous,
        ...response,
        next: response.next,
        stale: previous.stale || response.stale,
        items,
        loadedPages: (previous.loadedPages ?? 1) + 1,
        error: previous.error || response.refreshError,
      }
      update(source, page)
      try {
        await source.readCache.write(cacheKey(source, mode, 'list', search), {
          ...response,
          items,
          stale: page.stale,
          refreshError: page.error,
        })
      } catch {
        if (current === generation.current)
          update(source, {
            ...page,
            error: 'Results loaded, but could not be saved for offline use.',
          })
      }
    } catch (error) {
      if (current === generation.current) update(source, { ...previous, error: String(error) })
    } finally {
      if (current === generation.current) {
        setBusy(false)
        inFlight.current = null
      }
    }
  }
  const pages = sources.flatMap((source) => {
    const page = stored[source.key]
    return page &&
      page.source.scope === source.scope &&
      lastMode.current === mode &&
      lastSearch.current === search
      ? [{ ...page, source }]
      : []
  })
  return { sources, pages, busy, refresh, more }
}
