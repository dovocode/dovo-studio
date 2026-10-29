import { browserModelCatalogCache } from '@dovo/studio-core'
import { modelDisplayName, modelCatalogCacheScope } from '@dovo/protocol'
import { Schema } from 'effect'
import { useCatalogVisible } from './catalog-demand'
import { createModelLabels, type ModelLabelHarness } from './model-labels'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import {
  modelCatalogSchema,
  modelDiscoveryInput,
  useWorkspace,
  type TaskHarness,
} from '@dovo/studio-core'
const modelLabels = (() => {
  try {
    return createModelLabels(localStorage)
  } catch {
    return createModelLabels()
  }
})()
/** Read cached presentation metadata without discovering models or subscribing to workspace state. */
export function useModelLabel(address: string | undefined, harness: ModelLabelHarness | undefined) {
  return useSyncExternalStore(
    modelLabels.subscribe,
    () => (harness ? modelLabels.get(address, harness) : undefined),
    () => undefined,
  )
}
const cachedCatalogs = browserModelCatalogCache()
const cachedSchema = Schema.NullOr(modelCatalogSchema)
export function useHarnessCatalog(harness: TaskHarness, active: boolean) {
  const { request, connected, connection, snapshot, activeRuntimeId } = useWorkspace()
  const visible = useCatalogVisible()
  const savedModelName = useModelLabel(connection?.address, harness)
  const [state, setState] = useApplicationState({ key: '', loading: false, error: '' })
  const [refreshVersion, setRefreshVersion] = useApplicationState(0)
  const requestedRefresh = useRef(0)
  const input = modelDiscoveryInput(harness)
  const model = harness.model
  const scope = modelCatalogCacheScope(activeRuntimeId, connection, snapshot, harness)
  const key = scope.key
  const catalog = useSyncExternalStore(
    cachedCatalogs.subscribe,
    () => cachedCatalogs.peek(scope),
    () => null,
  )
  useEffect(() => {
    void cachedCatalogs.ensure(scope)
  }, [key])
  useEffect(() => {
    if (!active) return
    if (!visible) return
    let stopped = false
    if (!connected) return
    const refresh = refreshVersion !== requestedRefresh.current
    requestedRefresh.current = refreshVersion
    setState({ key, error: '', loading: refresh || !cachedCatalogs.isFresh(scope) })
    void cachedCatalogs
      .load(
        scope,
        () => request('/api/agents/models', { ...input, refresh }, modelCatalogSchema),
        refresh,
        () => request('/api/agents/models/cached', input, cachedSchema),
      )
      .then((value) => {
        if (!stopped) modelLabels.save(connection?.address, harness, value)
      })
      .catch((error) => {
        if (!stopped) setState({ key, error: String(error), loading: false })
      })
      .finally(() => {
        if (!stopped) setState((previous) => ({ ...previous, loading: false }))
      })
    return () => {
      stopped = true
    }
  }, [active, visible, connected, request, key, refreshVersion])
  return {
    catalog,
    modelName: modelDisplayName(
      model,
      catalog?.models.find((item) => item.id === model)?.name ?? savedModelName,
    ),
    error: state.key === key ? state.error : '',
    loading: active && visible && connected && (state.key !== key || state.loading),
    refresh: () => setRefreshVersion((version) => version + 1),
  }
}
