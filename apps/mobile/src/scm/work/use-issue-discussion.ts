import { useEffect, useRef } from 'react'
import { Effect, Schema } from 'effect'
import {
  combineIssueSections,
  matchingIssueSection,
  forgeIssueDetailSchema,
  mutableStruct,
  type ForgeIssueDetail,
  type RuntimeReadCache,
} from '@dovo/protocol'
import { AppState } from 'react-native'
import { useApplicationState } from '../../runtime/state/application-state'
import { startPolling, appendUniqueRows } from '@dovo/client-runtime'

type Section = 'discussion'
type Input = {
  overview?: ForgeIssueDetail
  cacheKey: string
  readCache?: RuntimeReadCache | null
  enabled: boolean
  refreshToken: number
  load: (
    section: Section,
    cursor: string | undefined,
    refresh: boolean,
    revision: string,
  ) => Promise<ForgeIssueDetail>
  refreshOverview: () => void
}
const cachedSchema = mutableStruct({
  ...forgeIssueDetailSchema.fields,
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
  const revision = overview?.issue.revision ?? ''
  const key = JSON.stringify([
    cacheKey,
    'section',
    section,
    revision,
    overview?.destination,
    overview?.issue.url,
  ])
  const [state, setState] = useApplicationState<{
    scope: string
    value?: ForgeIssueDetail
    error: string
    busy: boolean
    tick: number
  }>({
    scope: key,
    value: undefined,
    error: '',
    busy: false,
    tick: 0,
  })
  const forceNext = useRef(false)
  const moreNext = useRef<string | undefined>(undefined)
  const depth = useRef(1)
  const depthScope = JSON.stringify([cacheKey, overview?.destination, overview?.issue.url])
  const previousDepthScope = useRef({ key: depthScope, readCache })
  const token = useRef(refreshToken)
  const currentValue = state.scope === key ? state.value : undefined
  useEffect(() => {
    if (
      previousDepthScope.current.key !== depthScope ||
      previousDepthScope.current.readCache !== readCache
    )
      depth.current = 1
    previousDepthScope.current = { key: depthScope, readCache }
    moreNext.current = undefined
    setState((current) => ({ ...current, scope: key, value: undefined, error: '', busy: false }))
  }, [key, readCache])
  useEffect(() => {
    let stopped = false
    let hydrated = false
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
      const publish = async (value: ForgeIssueDetail, pages: number) => {
        if (stopped) return
        setState((current) => ({ ...current, value, error: value.refreshError ?? '' }))
        if (matchingIssueSection(overview, value)) {
          depth.current = pages
          await readCache?.write(key, { ...value, loadedPages: pages })
        }
      }
      try {
        if (!hydrated) {
          hydrated = true
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
          if (saved && !saved.value.overviewOnly && matchingIssueSection(overview, saved.value)) {
            depth.current = saved.value.loadedPages ?? 1
            setState((current) => ({
              ...current,
              value: current.value ?? { ...saved.value, stale: true },
              error: '',
            }))
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
          if (!matchingIssueSection(currentValue, value)) {
            await publish(value, 1)
            throw new Error('The issue changed. Refresh its overview before loading more comments.')
          }
          value = { ...value, comments: appendUniqueRows(currentValue.comments, value.comments) }
          await publish(value, Math.min(500, depth.current + 1))
        } else {
          const wanted = depth.current
          let pages = 1
          await publish(value, pages)
          while (
            !stopped &&
            value.next &&
            pages < wanted &&
            matchingIssueSection(overview, value)
          ) {
            const next = await load(section, value.next, refresh, revision)
            if (stopped) return
            if (!matchingIssueSection(value, next)) {
              await publish(next, 1)
              throw new Error(
                'The issue changed while comments were loading. Refresh its overview.',
              )
            }
            value = {
              ...next,
              comments: appendUniqueRows(value.comments, next.comments),
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
    ready: matchingIssueSection(overview, currentValue),
    busy: state.scope === key && state.busy,
    error: (state.scope === key ? state.error : '') || currentValue?.refreshError || '',
    refresh: () => {
      forceNext.current = true
      setState((current) => ({ ...current, tick: current.tick + 1 }))
    },
    more: () => {
      if (
        enabled &&
        !state.busy &&
        matchingIssueSection(overview, currentValue) &&
        currentValue?.next
      ) {
        moreNext.current = currentValue.next
        setState((current) => ({ ...current, tick: current.tick + 1 }))
      }
    },
  }
}
export function useIssueDiscussion(input: Input) {
  const discussion = useSection(input, 'discussion')
  const refresh = useRef(input.refreshOverview)
  refresh.current = input.refreshOverview
  const discovered =
    discussion.detail && input.overview && !matchingIssueSection(input.overview, discussion.detail)
      ? discussion.detail
      : undefined
  const discoveredKey = discovered
    ? JSON.stringify([
        input.cacheKey,
        discovered.destination,
        discovered.issue.url,
        discovered.issue.revision,
      ])
    : ''
  const lastDiscovered = useRef('')
  useEffect(() => {
    if (discoveredKey && lastDiscovered.current !== discoveredKey) {
      lastDiscovered.current = discoveredKey
      refresh.current()
    }
  }, [discoveredKey])
  return { ...discussion, issue: combineIssueSections(input.overview, discussion.detail) }
}
