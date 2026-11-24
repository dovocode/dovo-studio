import { createRoute, useRouter, type HistoryState } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Route as rootRoute } from './__root'
import { Workbench, type WorkbenchLocation } from '@dovo/studio-shell'
import { tasksExtension } from '@dovo/extension-tasks'
import { scmExtension } from '@dovo/extension-scm'
import { agentsExtension } from '@dovo/extension-agents'
import { jobsExtension } from '@dovo/extension-jobs'
import { runtimeExtension } from '@dovo/extension-runtime'
const extensions = [tasksExtension, scmExtension, agentsExtension, jobsExtension, runtimeExtension]
const sections = new Set(
  extensions.flatMap((extension) =>
    extension.views.filter((view) => !view.navigationGroup).map((view) => view.id),
  ),
)
type WorkbenchSearch = {
  section?: string
  thread?: string
  computer?: string
  profile?: string
}
type PullLocation = Extract<WorkbenchLocation, { kind: 'pull' }>
type WorkbenchHistoryState = HistoryState & { dovoPull?: PullLocation }

function pullLocation(state: unknown): PullLocation | undefined {
  if (!state || typeof state !== 'object' || !('dovoPull' in state)) return
  const location = state.dovoPull
  if (
    !location ||
    typeof location !== 'object' ||
    !('kind' in location) ||
    location.kind !== 'pull' ||
    !('ownerScope' in location) ||
    typeof location.ownerScope !== 'string' ||
    !/^[a-f\d]{64}$/.test(location.ownerScope) ||
    !('pullTarget' in location)
  )
    return
  const target = location.pullTarget
  if (!target || typeof target !== 'object' || !('runtimeId' in target) || !('number' in target))
    return
  const { runtimeId, number, repositoryId, connectionId, url, tab, fragment } = target as Record<
    string,
    unknown
  >
  const text = (value: unknown, limit: number): value is string =>
    typeof value === 'string' && value.length <= limit
  if (
    !text(runtimeId, 200) ||
    !runtimeId ||
    typeof number !== 'number' ||
    !Number.isSafeInteger(number) ||
    number < 1 ||
    (repositoryId !== undefined && !text(repositoryId, 200)) ||
    (connectionId !== undefined && !text(connectionId, 200)) ||
    (url !== undefined && (!text(url, 4000) || !/^https?:\/\//i.test(url))) ||
    (fragment !== undefined && !text(fragment, 4000)) ||
    (tab !== undefined && tab !== 'overview' && tab !== 'changes' && tab !== 'checks')
  )
    return
  return {
    kind: 'pull',
    ownerScope: location.ownerScope,
    pullTarget: { runtimeId, number, repositoryId, connectionId, url, tab, fragment },
  }
}
function validateSearch(search: Record<string, unknown>): WorkbenchSearch {
  const id = (value: unknown) =>
    typeof value === 'string' && value.length <= 200 && value.trim() === value && value.length
      ? value
      : undefined
  const thread = id(search.thread)
  const computer = id(search.computer)
  const profile = id(search.profile)
  const section = id(search.section)
  if (thread && computer) return { thread, computer }
  if (thread && profile) return { thread, profile }
  if (section && sections.has(section) && section !== 'tasks') return { section }
  return {}
}
function location(search: WorkbenchSearch, state: unknown): WorkbenchLocation {
  if (search.thread && search.computer)
    return { kind: 'thread', threadId: search.thread, runtimeIdentity: search.computer }
  if (search.thread && search.profile)
    return { kind: 'thread', threadId: search.thread, runtimeId: search.profile }
  const pull = search.section === 'pulls' ? pullLocation(state) : undefined
  return pull ?? { kind: 'section', viewId: search.section ?? 'tasks' }
}
function searchFor(target: WorkbenchLocation): WorkbenchSearch {
  if (target.kind === 'pull') return { section: 'pulls' }
  if (target.kind === 'thread')
    return target.runtimeIdentity
      ? { thread: target.threadId, computer: target.runtimeIdentity }
      : { thread: target.threadId, profile: target.runtimeId }
  return target.viewId !== 'tasks' && sections.has(target.viewId) ? { section: target.viewId } : {}
}
export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch,
  component: WebWorkbench,
})

function WebWorkbench() {
  const search = Route.useSearch()
  const router = useRouter()
  const [initial, setInitial] = useState(() =>
    search.thread || search.section ? location(search, router.state.location.state) : undefined,
  )
  const travel = useRef<(target: WorkbenchLocation) => Promise<boolean>>(undefined)
  useEffect(
    () =>
      router.history.block({
        enableBeforeUnload: false,
        blockerFn: async ({ action, nextLocation }) => {
          if (action === 'PUSH' || action === 'REPLACE') return false
          const next = router.parseLocation(nextLocation)
          const [, , route] = router.getMatchedRoutes(next.pathname)
          if (route?.id !== '/') return false
          const target = location(validateSearch(next.search), next.state)
          if (travel.current) return !(await travel.current(target))
          setInitial(target)
          return false
        },
      }),
    [router],
  )
  const webHistory = useMemo(
    () => ({
      initial,
      write: (target: WorkbenchLocation, replace: boolean) => {
        const search = searchFor(target)
        const state: WorkbenchHistoryState = target.kind === 'pull' ? { dovoPull: target } : {}
        const current = router.latestLocation
        if (
          JSON.stringify(validateSearch(current.search)) === JSON.stringify(search) &&
          JSON.stringify(pullLocation(current.state)) === JSON.stringify(pullLocation(state))
        )
          return
        void router.navigate({ to: '/', search, state, replace, resetScroll: false })
      },
      listen: (listener: (target: WorkbenchLocation) => Promise<boolean>) => {
        travel.current = listener
        return () => {
          if (travel.current === listener) travel.current = undefined
        }
      },
      back: () => {
        if (!router.history.canGoBack()) return false
        router.history.back()
        return true
      },
    }),
    [initial, router],
  )
  return <Workbench extensions={extensions} webHistory={webHistory} />
}
