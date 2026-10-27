import { useEffect, useRef } from 'react'
import { Effect, Schema } from 'effect'
import {
  combinePipelineSections,
  matchingPipelineSection,
  pipelineRevision,
  forgePipelineDetailSchema,
  mutableStruct,
  type ForgePipelineDetail,
  type RuntimeReadCache,
} from '@dovo/protocol'
import { AppState } from 'react-native'
import { useApplicationState } from '../../runtime/state/application-state'
import { startPolling, appendUniqueRows } from '@dovo/client-runtime'

type Section = 'jobs' | 'graph'
type Input = {
  overview?: ForgePipelineDetail
  cacheKey: string
  readCache?: RuntimeReadCache | null
  enabled: boolean
  refreshToken: number
  load: (
    section: Section,
    cursor: string | undefined,
    refresh: boolean,
    revision: string,
  ) => Promise<ForgePipelineDetail>
  refreshOverview: () => void
}
const cachedSchema = mutableStruct({
  ...forgePipelineDetailSchema.fields,
  overviewOnly: Schema.optional(Schema.Boolean),
  loadedPages: Schema.optional(
    Schema.Number.pipe(
      Schema.check(Schema.isInt()),
      Schema.check(Schema.isBetween({ minimum: 1, maximum: 500 })),
    ),
  ),
})
function useSection(input: Input, section: Section) {
  const { overview, cacheKey, readCache, enabled, refreshToken, load } = input
  const revision = overview ? pipelineRevision(overview.run) : ''
  const key = JSON.stringify([
    cacheKey,
    'section',
    section,
    revision,
    overview?.destination,
    overview?.run.url,
  ])
  const [state, setState] = useApplicationState<{
    scope: string
    value?: ForgePipelineDetail
    error: string
    cacheError: string
    busy: boolean
    tick: number
  }>({
    scope: key,
    value: undefined,
    error: '',
    cacheError: '',
    busy: false,
    tick: 0,
  })
  const forceNext = useRef(false)
  const moreNext = useRef<string | undefined>(undefined)
  const depth = useRef(1)
  const token = useRef(refreshToken)
  const currentValue = state.scope === key ? state.value : undefined
  useEffect(() => {
    depth.current = 1
    moreNext.current = undefined
    setState((current) => ({
      ...current,
      scope: key,
      value: undefined,
      error: '',
      cacheError: '',
      busy: false,
    }))
  }, [key, readCache])
  useEffect(() => {
    let stopped = false
    let hydrated = false
    let hydrationError = ''
    setState((current) => ({ ...current, cacheError: '' }))
    const invalidated = token.current !== refreshToken
    if (invalidated) {
      forceNext.current = true
      token.current = refreshToken
      setState((current) => ({
        ...current,
        value: current.value ? { ...current.value, stale: true } : undefined,
      }))
    }
    let force = forceNext.current
    let cursor = moreNext.current
    if (enabled) {
      forceNext.current = false
      moreNext.current = undefined
    }
    const loadSection = async () => {
      const publish = async (value: ForgePipelineDetail, pages: number) => {
        if (stopped) return
        setState((current) => ({ ...current, value, error: value.refreshError ?? '' }))
        if (matchingPipelineSection(overview, value)) {
          depth.current = pages
          try {
            await readCache?.write(key, { ...value, loadedPages: pages })
            if (!stopped) setState((current) => ({ ...current, cacheError: hydrationError }))
          } catch {
            if (!stopped)
              setState((current) => ({
                ...current,
                cacheError: `${section === 'jobs' ? 'Jobs' : 'Workflow'} loaded, but could not be saved for offline use.`,
              }))
          }
        }
      }
      try {
        if (!hydrated) {
          hydrated = true
          try {
            if (invalidated) {
              await readCache?.remove(key)
              const legacy = await readCache?.read(cacheKey, cachedSchema)
              if (legacy && !legacy.value.overviewOnly) await readCache?.remove(cacheKey)
            }
            const saved = invalidated
              ? undefined
              : ((await readCache?.read(key, cachedSchema)) ??
                (await readCache?.read(cacheKey, cachedSchema)))
            if (stopped) return
            if (
              saved &&
              !saved.value.overviewOnly &&
              matchingPipelineSection(overview, saved.value)
            ) {
              depth.current = saved.value.loadedPages ?? 1
              setState((current) => ({
                ...current,
                value: current.value ?? { ...saved.value, stale: true },
                error: '',
              }))
            }
          } catch {
            hydrationError = invalidated
              ? `Saved ${section} could not be cleared. Live data is still available.`
              : `Saved ${section} could not be read from this device.`
            if (!stopped) setState((current) => ({ ...current, cacheError: hydrationError }))
          }
        }
        if (!enabled || !overview || !(AppState.currentState === 'active')) return
        setState((current) => ({ ...current, busy: true }))
        const refresh = force
        force = false
        const nextCursor = cursor
        cursor = undefined
        let value = await load(section, nextCursor, refresh, revision)
        if (stopped) return
        if (nextCursor && currentValue) {
          if (!matchingPipelineSection(currentValue, value)) {
            await publish(value, 1)
            throw new Error(
              'The pipeline attempt changed. Refresh its overview before loading more jobs.',
            )
          }
          value = { ...value, jobs: appendUniqueRows(currentValue.jobs, value.jobs) }
          await publish(value, Math.min(500, depth.current + 1))
        } else {
          const wanted = section === 'jobs' ? depth.current : 1
          let pages = 1
          await publish(value, pages)
          while (
            !stopped &&
            value.next &&
            pages < wanted &&
            matchingPipelineSection(overview, value)
          ) {
            const next = await load(section, value.next, refresh, revision)
            if (stopped) return
            if (!matchingPipelineSection(value, next)) {
              await publish(next, 1)
              throw new Error(
                'The pipeline attempt changed while jobs were loading. Refresh its overview.',
              )
            }
            value = {
              ...next,
              jobs: appendUniqueRows(value.jobs, next.jobs),
              stale: value.stale || next.stale,
              refreshError: value.refreshError ?? next.refreshError,
            }
            await publish(value, ++pages)
          }
        }
      } catch (error) {
        if (!stopped)
          setState((current) => ({
            ...current,
            error: error instanceof Error ? error.message : String(error),
            value: current.value ? { ...current.value, stale: true } : undefined,
          }))
      } finally {
        if (!stopped) setState((current) => ({ ...current, busy: false }))
      }
    }
    const polling = startPolling(
      Effect.tryPromise({
        try: loadSection,
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),
      {
        interval: 30000,
        onError: (error) => {
          if (!stopped) setState((current) => ({ ...current, error: error.message }))
        },
      },
    )
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') polling.refresh()
    })
    return () => {
      stopped = true
      subscription.remove()
      void polling.stop()
    }
  }, [key, cacheKey, readCache, enabled, load, refreshToken, state.tick])
  return {
    detail: currentValue,
    ready: matchingPipelineSection(overview, currentValue),
    busy: state.scope === key && state.busy,
    error:
      (state.scope === key ? state.error || state.cacheError : '') ||
      currentValue?.refreshError ||
      '',
    refresh: () => {
      forceNext.current = true
      setState((current) => ({ ...current, tick: current.tick + 1 }))
    },
    more: () => {
      if (
        enabled &&
        !state.busy &&
        matchingPipelineSection(overview, currentValue) &&
        currentValue?.next
      ) {
        moreNext.current = currentValue.next
        setState((current) => ({ ...current, tick: current.tick + 1 }))
      }
    },
  }
}
export function usePipelineSections(input: Input) {
  const jobs = useSection(input, 'jobs')
  const graph = useSection(input, 'graph')
  const refresh = useRef(input.refreshOverview)
  refresh.current = input.refreshOverview
  const discovered = [jobs.detail, graph.detail].find(
    (value) => value && input.overview && !matchingPipelineSection(input.overview, value),
  )
  const discoveredKey = discovered
    ? JSON.stringify([
        input.cacheKey,
        discovered.destination,
        discovered.run.url,
        pipelineRevision(discovered.run),
      ])
    : ''
  const lastDiscovered = useRef('')
  useEffect(() => {
    if (discoveredKey && lastDiscovered.current !== discoveredKey) {
      lastDiscovered.current = discoveredKey
      refresh.current()
    }
  }, [discoveredKey])
  return { jobs, graph, detail: combinePipelineSections(input.overview, jobs.detail, graph.detail) }
}
