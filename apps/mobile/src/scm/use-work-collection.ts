import { useEffect, useRef, useState } from 'react'
import {
  forgeWorkOptionsSchema,
  forgeIssuePageSchema,
  forgePipelinePageSchema,
  type ForgeIssue,
  type ForgePipeline,
  type ForgeWorkOptions,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import {
  workSources,
  workSourceIdentity,
  workSourceInput,
  type WorkSource,
  retainWorkPages,
} from './work-sources'
import { useNavigation } from '../shell/navigation'
import { workCacheKey } from './work-cache'
import { refreshFirstPage } from './collection-pages'

export type WorkPage = {
  source: WorkSource
  options?: ForgeWorkOptions
  items: Array<ForgeIssue | ForgePipeline>
  next?: string
  stale: boolean
  searched?: boolean
  error?: string
  firstPageIds?: string[]
  paginated?: boolean
}
export function useWorkCollection(
  mode: 'issues' | 'pipelines',
  repositoryKey: string,
  state: string,
  query = '',
) {
  const { overviews, readRuntime, cacheForRuntime } = useRuntime()
  const { focused } = useNavigation()
  const sources = workSources(overviews, mode).filter(
    (entry) => !repositoryKey || entry.key === repositoryKey,
  )
  const identity = workSourceIdentity(sources)
  const sourcesRef = useRef(sources)
  sourcesRef.current = sources
  const [pages, setPages] = useState<Record<string, WorkPage>>({})
  const pageRef = useRef(pages)
  const generation = useRef(0)
  const inFlight = useRef<number | null>(null)
  const forceNext = useRef(false)
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const lastQuery = useRef('')
  const update = (key: string, page: WorkPage) => {
    pageRef.current = { ...pageRef.current, [key]: page }
    setPages(pageRef.current)
  }
  const load = async (source: WorkSource, current: number, cursor?: string, force = false) => {
    const cache = cacheForRuntime(source.profile)
    const optionsKey = workCacheKey(
      source.kind === 'jira' ? source.jiraSource : source.repository,
      mode,
      'options',
    )
    const pageKey = workCacheKey(
      source.kind === 'jira' ? source.jiraSource : source.repository,
      mode,
      'list',
      { state, cursor, query },
    )
    let page: WorkPage = pageRef.current[source.key] ?? { source, items: [], stale: true }
    try {
      if (!cursor) {
        const [options, cached] = await Promise.all([
          cache.read(optionsKey, forgeWorkOptionsSchema),
          mode === 'issues'
            ? cache.read(pageKey, forgeIssuePageSchema)
            : cache.read(pageKey, forgePipelinePageSchema),
        ])
        // Offline searches can still filter the saved first page when this query has
        // never been requested before; distinguish it from server-filtered results.
        const saved =
          cached ??
          (mode === 'issues' && query
            ? await cache.read(
                workCacheKey(
                  source.kind === 'jira' ? source.jiraSource : source.repository,
                  mode,
                  'list',
                  { state },
                ),
                forgeIssuePageSchema,
              )
            : undefined)
        if (generation.current !== current) return
        page = {
          ...page,
          source,
          options: options?.value ?? page.options,
          items: page.items.length ? page.items : (saved?.value.items ?? []),
          next: page.items.length ? page.next : saved?.value.next,
          searched: page.items.length
            ? page.searched
            : !!cached && !!query && !!options?.value.issueSearch,
          stale: page.items.length ? page.stale : true,
          error: undefined,
        }
        update(source.key, page)
      }
    } catch {
      page = { ...page, error: 'Saved work could not be read from this device.' }
      if (generation.current === current) update(source.key, page)
    }
    if (!source.connected || generation.current !== current || !focused) return
    try {
      const options = await readRuntime(
        source.profile,
        '/api/scm/work/options',
        { ...workSourceInput(source), area: mode },
        forgeWorkOptionsSchema,
      )
      if (generation.current !== current) return
      if (!(mode === 'issues' ? options.issues : options.pipelines)) {
        update(source.key, { source, options, items: [], stale: false })
        await cache.write(optionsKey, options)
        return
      }
      const sourceState =
        state === 'all'
          ? 'all'
          : options.provider === 'jira'
            ? state
            : options.issueStates.find((value) => value.toLowerCase() === state.toLowerCase())
      if (mode === 'issues' && !sourceState) {
        update(source.key, { source, options, items: [], stale: false })
        return
      }
      const data =
        mode === 'issues'
          ? await readRuntime(
              source.profile,
              '/api/scm/work/issues/list',
              {
                ...workSourceInput(source),
                state: sourceState,
                ...(options.issueSearch && query ? { query } : {}),
                cursor,
                refresh: force,
              },
              forgeIssuePageSchema,
            )
          : await readRuntime(
              source.profile,
              '/api/scm/work/pipelines/list',
              { ...workSourceInput(source), cursor, refresh: force },
              forgePipelinePageSchema,
            )
      if (generation.current !== current) return
      const retaining = !cursor && !force && page.paginated && page.firstPageIds
      const next: WorkPage = {
        source,
        options,
        items: cursor
          ? [...new Map([...page.items, ...data.items].map((item) => [item.id, item])).values()]
          : retaining
            ? refreshFirstPage(page.items, page.firstPageIds ?? [], data.items, (item) => item.id)
            : data.items,
        searched: mode === 'issues' && !!query && !!options.issueSearch,
        firstPageIds: cursor ? page.firstPageIds : data.items.map((item) => item.id),
        paginated: !!cursor || !!retaining,
        next: retaining ? page.next : data.next,
        stale: !!data.stale || !!data.refreshError || ((!!cursor || !!retaining) && page.stale),
        error: data.refreshError || (cursor || retaining ? page.error : undefined),
      }
      update(source.key, next)
      try {
        await Promise.all([cache.write(optionsKey, options), cache.write(pageKey, data)])
      } catch {
        if (generation.current === current)
          update(source.key, {
            ...next,
            error: 'Work loaded, but could not be saved for offline use.',
          })
      }
    } catch (error) {
      if (generation.current === current)
        update(source.key, {
          ...page,
          source,
          stale: true,
          error: error instanceof Error ? error.message : String(error),
        })
    }
  }
  const loadRef = useRef(load)
  loadRef.current = load
  useEffect(() => {
    const current = ++generation.current
    const queryKey = JSON.stringify([state, mode, query])
    pageRef.current =
      lastQuery.current !== queryKey
        ? {}
        : Object.fromEntries(
            retainWorkPages(Object.values(pageRef.current), sourcesRef.current).map((page) => [
              page.source.key,
              page,
            ]),
          )
    setPages(pageRef.current)
    lastQuery.current = queryKey
    setBusy(focused && sourcesRef.current.some((source) => source.connected))
    const force = forceNext.current
    forceNext.current = false
    inFlight.current = current
    void (async () => {
      const entries = sourcesRef.current
      for (let i = 0; i < entries.length && generation.current === current; i += 3)
        await Promise.all(
          entries
            .slice(i, i + 3)
            .map((source) => loadRef.current(source, current, undefined, force)),
        )
      if (inFlight.current === current) inFlight.current = null
      if (generation.current === current) setBusy(false)
    })()
    return () => {
      generation.current++
    }
  }, [identity, state, mode, query, revision, focused])
  const refresh = () => {
    forceNext.current = true
    setRevision((value) => value + 1)
  }
  const more = async (key: string) => {
    const page = pageRef.current[key]
    if (
      !page ||
      !page.source.connected ||
      !focused ||
      busy ||
      inFlight.current === generation.current
    )
      return
    if (page.error) return refresh()
    if (!page.next) return
    const current = generation.current
    inFlight.current = current
    setBusy(true)
    await loadRef.current(page.source, current, page.next)
    if (inFlight.current === current) inFlight.current = null
    if (generation.current === current) setBusy(false)
  }
  return {
    pages:
      lastQuery.current === JSON.stringify([state, mode, query])
        ? retainWorkPages(Object.values(pages), sources)
        : [],
    sources,
    busy,
    refresh,
    more,
  }
}
