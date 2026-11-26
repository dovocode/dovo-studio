import { DiscoveryCache } from '@dovo/studio-core'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useApplicationState } from '@dovo/studio-core/state'
import { useWorkspace } from '@dovo/studio-core'
import { useCatalogVisible } from './catalog-demand'
import {
  harnessAvailabilitySchema,
  harnessAvailabilityCandidates,
  modelCatalogCacheScope,
  type Agent,
  type HarnessAvailability,
} from '@dovo/protocol'

const cache = new DiscoveryCache<HarnessAvailability>(30_000, {
  cacheable: (choices) => choices.length > 0 && choices.every((item) => item.available),
  retainOnError: false,
  maxPending: 64,
})

export function useHarnessAvailability(
  repositoryId: string | undefined,
  active: boolean,
  agents: readonly Agent[],
  prefetch = false,
  /** The thread runs in a container sandbox: only harnesses that can run there are available. */
  sandboxed = false,
  access?: { taskId?: string },
) {
  const { connection, connected, request, snapshot, activeRuntimeId } = useWorkspace()
  const visible = useCatalogVisible()
  const key = JSON.stringify([
    repositoryId,
    !!access,
    access?.taskId,
    harnessAvailabilityCandidates(agents, snapshot?.acpInstallations ?? [])
      .map(({ id, agent }) => [
        id,
        modelCatalogCacheScope(activeRuntimeId, connection, snapshot, agent).key,
      ])
      .sort(([left], [right]) => left.localeCompare(right)),
  ])
  const choices = useSyncExternalStore(
    cache.subscribe,
    () => cache.peek(key),
    () => null,
  )
  const [state, setState] = useApplicationState<{
    key: string
    loading: boolean
    error: string
  }>({ key: '', loading: false, error: '' })
  const [refreshVersion, setRefreshVersion] = useApplicationState(0)
  const requestedRefresh = useRef(0)
  useEffect(() => {
    if ((!active && !prefetch) || !visible || !connected) return
    let stopped = false
    const refresh = refreshVersion !== requestedRefresh.current
    requestedRefresh.current = refreshVersion
    setState(() => ({
      key,
      loading: refresh || !cache.isFresh(key),
      error: '',
    }))
    void cache
      .load(
        key,
        () =>
          request(
            '/api/agents/availability',
            { repositoryId, taskId: access?.taskId, checkAccess: !!access, refresh },
            harnessAvailabilitySchema,
          ),
        refresh,
      )
      .then(() => {
        if (!stopped) setState({ key, loading: false, error: '' })
      })
      .catch((error: unknown) => {
        if (!stopped) setState({ key, loading: false, error: String(error) })
      })
    return () => {
      stopped = true
    }
  }, [key, active, prefetch, visible, connected, request, refreshVersion])
  const usable =
    connected && (cache.isFresh(key) || (state.key === key && !state.loading && !state.error))
  const ready = (usable ? (choices ?? []) : []).filter((item) => item.available)
  return {
    claudeAutoLimits: new Map(
      ready.flatMap(({ id, claudeAutoDisabledBy }) =>
        claudeAutoDisabledBy && !sandboxed ? [[id, claudeAutoDisabledBy] as const] : [],
      ),
    ),
    available: new Set(
      ready
        .filter((item) => !sandboxed || item.sandbox?.supported !== false)
        .map((item) => item.id),
    ),
    /** Why a harness cannot run in the sandbox, or what it needs there. */
    sandboxNotes: sandboxed
      ? ready.flatMap((item) => (item.sandbox?.note ? [{ id: item.id, ...item.sandbox }] : []))
      : [],
    loading: active && visible && connected && (state.key !== key || state.loading),
    error: state.key === key ? state.error : '',
    refresh: () => setRefreshVersion((version) => version + 1),
  }
}
