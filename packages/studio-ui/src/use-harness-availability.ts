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
) {
  const { connection, connected, request, snapshot, activeRuntimeId } = useWorkspace()
  const visible = useCatalogVisible()
  const key = JSON.stringify([
    repositoryId,
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
          request('/api/agents/availability', { repositoryId, refresh }, harnessAvailabilitySchema),
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
  return {
    available: new Set(
      (usable ? (choices ?? []) : []).filter((item) => item.available).map((item) => item.id),
    ),
    loading: active && visible && connected && (state.key !== key || state.loading),
    error: state.key === key ? state.error : '',
    refresh: () => setRefreshVersion((version) => version + 1),
  }
}
