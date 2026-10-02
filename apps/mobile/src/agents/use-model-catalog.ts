import AsyncStorage from '@react-native-async-storage/async-storage'
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import {
  modelCatalogSchema,
  modelDiscoveryInput,
  modelDisplayName,
  type AgentDiscovery,
  type RuntimeProfile,
} from '@dovo/protocol'
import { useApplicationState } from '../runtime/state/application-state'
import { useRuntime } from '../runtime/connection/provider'
import { MobileModelCatalogCache, mobileModelCatalogKey } from './model-catalog-cache'

const cache = new MobileModelCatalogCache(AsyncStorage, (key) =>
  digestStringAsync(CryptoDigestAlgorithm.SHA256, key),
)
export function loadMobileModelCatalog(
  profile: RuntimeProfile,
  agent: AgentDiscovery,
  request: (
    input: AgentDiscovery & { refresh: boolean },
  ) => Promise<import('@dovo/protocol').ModelCatalog>,
  refresh = false,
) {
  return cache.load(
    mobileModelCatalogKey(profile, agent),
    () => request({ ...modelDiscoveryInput(agent), refresh }),
    refresh,
  )
}
/** Rows only read cached metadata. Discovery is shared by composer and model settings. */
export function useCachedModelCatalog(
  agent: AgentDiscovery | undefined,
  profile: RuntimeProfile | undefined,
) {
  const key = agent && profile ? mobileModelCatalogKey(profile, agent) : ''
  const catalog = useSyncExternalStore(
    cache.subscribe,
    () => (key ? cache.peek(key) : null),
    () => null,
  )
  useEffect(() => {
    if (key)
      void cache
        .ensure(key)
        .catch((error: unknown) => console.warn('Could not restore model metadata', error))
  }, [key])
  return {
    catalog,
    modelName: agent
      ? modelDisplayName(
          agent.model,
          catalog?.models.find((model) => model.id === agent.model)?.name,
        )
      : '',
  }
}
export function useModelCatalog(agent: AgentDiscovery | undefined, active = true) {
  const { profile, connected, readRuntime } = useRuntime()
  const { catalog, modelName } = useCachedModelCatalog(agent, profile ?? undefined)
  const key = agent && profile ? mobileModelCatalogKey(profile, agent) : ''
  const [state, setState] = useApplicationState({ key: '', loading: false, error: '' })
  const [refresh, setRefresh] = useApplicationState(0)
  const lastRefresh = useRef(0)
  const canDiscover =
    !!agent &&
    !!profile &&
    connected &&
    active &&
    (agent.provider !== 'acp' ||
      !!agent.acpInstallationId ||
      !!agent.endpoint.trim() ||
      refresh > 0)
  useEffect(() => {
    if (!canDiscover || !agent || !profile) return
    let stopped = false
    const force = refresh !== lastRefresh.current
    lastRefresh.current = refresh
    if (!force && cache.isFresh(key)) {
      setState({ key, loading: false, error: '' })
      return
    }
    setState({ key, loading: true, error: '' })
    const timer = setTimeout(() => {
      void loadMobileModelCatalog(
        profile,
        agent,
        (input) => readRuntime(profile, '/api/agents/models', input, modelCatalogSchema),
        force,
      )
        .then(() => {
          if (!stopped) setState({ key, loading: false, error: '' })
        })
        .catch((error: unknown) => {
          if (!stopped) setState({ key, loading: false, error: String(error) })
        })
    }, 200)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [key, canDiscover, readRuntime, refresh])
  return {
    catalog,
    modelName,
    canDiscover,
    loading: canDiscover && state.key === key && state.loading,
    error: state.key === key ? state.error : '',
    refresh: () => setRefresh((value) => value + 1),
  }
}
