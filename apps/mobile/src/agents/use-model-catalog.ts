import AsyncStorage from '@react-native-async-storage/async-storage'
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto'
import { useMemo, useEffect, useRef, useSyncExternalStore } from 'react'
import {
  modelCatalogSchema,
  modelDiscoveryInput,
  modelDisplayName,
  type AgentDiscovery,
  type RuntimeProfile,
  type RuntimeSnapshot,
} from '@dovo/protocol'
import { Schema } from 'effect'
import { useAppActive } from '../runtime/state/app-active'
import { useApplicationState } from '../runtime/state/application-state'
import { useRuntime, useRuntimeSelector } from '../runtime/connection/provider'
import {
  MobileModelCatalogCache,
  mobileModelCatalogScope,
  mobileModelCatalogScopeReader,
} from './model-catalog-cache'

const cachedSchema = Schema.NullOr(modelCatalogSchema)
const cache = new MobileModelCatalogCache(AsyncStorage, (key) =>
  digestStringAsync(CryptoDigestAlgorithm.SHA256, key),
)
type CatalogScope = ReturnType<typeof mobileModelCatalogScope>
const sameScope = (left: CatalogScope | null, right: CatalogScope | null) =>
  left?.key === right?.key && left?.presentationKey === right?.presentationKey
export function loadMobileModelCatalog(
  profile: RuntimeProfile,
  agent: AgentDiscovery,
  request: (
    input: AgentDiscovery & { refresh: boolean },
  ) => Promise<import('@dovo/protocol').ModelCatalog>,
  refresh = false,
  snapshot?: RuntimeSnapshot | null,
  cachedRequest?: () => Promise<import('@dovo/protocol').ModelCatalog | null>,
) {
  return cache.load(
    mobileModelCatalogScope(profile, agent, snapshot),
    () => request({ ...modelDiscoveryInput(agent), refresh }),
    refresh,
    cachedRequest,
  )
}
/** Rows only read cached metadata. Discovery is shared by composer and model settings. */
export function useCachedModelCatalog(
  agent: AgentDiscovery | undefined,
  profile: RuntimeProfile | undefined,
) {
  const scope = useRuntimeSelector(
    useMemo(() => mobileModelCatalogScopeReader(profile, agent), [agent, profile]),
    sameScope,
  )
  const key = scope?.key ?? ''
  const catalog = useSyncExternalStore(
    cache.subscribe,
    () => (scope ? cache.peek(scope) : null),
    () => null,
  )
  useEffect(() => {
    if (scope)
      void cache
        .ensure(scope)
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
  const { profile, connected, readRuntime, snapshot } = useRuntime()
  const foreground = useAppActive()
  const { catalog, modelName } = useCachedModelCatalog(agent, profile ?? undefined)
  const scope = agent && profile ? mobileModelCatalogScope(profile, agent, snapshot) : null
  const key = scope?.key ?? ''
  const [state, setState] = useApplicationState({ key: '', loading: false, error: '' })
  const [refresh, setRefresh] = useApplicationState(0)
  const lastRefresh = useRef(0)
  const canDiscover =
    !!agent &&
    !!profile &&
    connected &&
    active &&
    foreground &&
    (agent.provider !== 'acp' ||
      !!agent.acpInstallationId ||
      !!agent.endpoint.trim() ||
      refresh > 0)
  useEffect(() => {
    if (!canDiscover || !agent || !profile || !scope) return
    let stopped = false
    const force = refresh !== lastRefresh.current
    lastRefresh.current = refresh
    if (!force && cache.isFresh(scope)) {
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
        snapshot,
        () =>
          readRuntime(
            profile,
            '/api/agents/models/cached',
            modelDiscoveryInput(agent),
            cachedSchema,
          ),
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
