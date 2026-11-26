import { DiscoveryCache } from '@dovo/client-runtime'
import { useEffect, useSyncExternalStore } from 'react'
import {
  harnessAvailabilitySchema,
  harnessAvailabilityCandidates,
  modelCatalogCacheScope,
  type Agent,
  type HarnessAvailability,
} from '@dovo/protocol'
import { useApplicationState } from '../runtime/state/application-state'
import { useRuntime } from '../runtime/connection/provider'
import { useAppActive } from '../runtime/state/app-active'

const cache = new DiscoveryCache<HarnessAvailability>(30_000, {
  cacheable: (choices) => choices.length > 0 && choices.every((item) => item.available),
  retainOnError: false,
  maxPending: 64,
})

export function useHarnessAvailability(
  repositoryId: string | undefined,
  agents: readonly Agent[],
  /** The thread runs in a container sandbox: only harnesses that can run there are available. */
  sandboxed = false,
  access?: { taskId?: string },
) {
  const { profile, connected, readRuntime, snapshot } = useRuntime()
  const foreground = useAppActive()
  const key = JSON.stringify([
    repositoryId,
    !!access,
    access?.taskId,
    harnessAvailabilityCandidates(agents, snapshot?.acpInstallations ?? [])
      .map(({ id, agent }) => [
        id,
        modelCatalogCacheScope(profile?.id, profile?.connection, snapshot, agent).key,
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
  useEffect(() => {
    if (!profile || !connected || !foreground) return
    let stopped = false
    setState({ key, loading: !cache.isFresh(key), error: '' })
    void cache
      .load(key, () =>
        readRuntime(
          profile,
          '/api/agents/availability',
          { repositoryId, taskId: access?.taskId, checkAccess: !!access },
          harnessAvailabilitySchema,
        ),
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
  }, [key, connected, foreground, readRuntime])
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
    loading: foreground && connected && (state.key !== key || state.loading),
    error: state.key === key ? state.error : '',
  }
}
