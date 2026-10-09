import { DiscoveryCache } from '@dovo/client-runtime'
import { useEffect, useSyncExternalStore } from 'react'
import {
  harnessAvailabilitySchema,
  modelDiscoveryInput,
  type Agent,
  type HarnessAvailability,
} from '@dovo/protocol'
import { useApplicationState } from '../runtime/state/application-state'
import { useRuntime } from '../runtime/connection/provider'

const cache = new DiscoveryCache<HarnessAvailability>(30_000)

export function useHarnessAvailability(repositoryId: string, agents: readonly Agent[]) {
  const { profile, connected, readRuntime, snapshot } = useRuntime()
  const key = JSON.stringify([
    profile?.connection,
    snapshot?.runtimeInstanceId,
    repositoryId,
    agents.map(modelDiscoveryInput),
    snapshot?.acpInstallations,
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
    if (!profile || !connected) return
    let stopped = false
    setState({ key, loading: !cache.isFresh(key), error: '' })
    void cache
      .load(key, () =>
        readRuntime(
          profile,
          '/api/agents/availability',
          { repositoryId },
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
  }, [key, connected, readRuntime])
  return {
    available: new Set((choices ?? []).filter((item) => item.available).map((item) => item.id)),
    loading: connected && (state.key !== key || state.loading),
    error: state.key === key ? state.error : '',
  }
}
