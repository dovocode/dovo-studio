import { DiscoveryCache } from '@dovo/studio-core'
import { createModelLabels, type ModelLabelHarness } from './model-labels'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useSyncExternalStore } from 'react'
import {
  modelCatalogSchema,
  modelDiscoveryInput,
  useWorkspace,
  type TaskHarness,
  type ModelCatalog,
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
const cachedCatalogs = new DiscoveryCache<ModelCatalog>(5 * 60_000)
export function useHarnessCatalog(harness: TaskHarness, active: boolean) {
  const { request, connected, connection, snapshot } = useWorkspace()
  const savedModelName = useModelLabel(connection?.address, harness)
  const [state, setState] = useApplicationState({ key: '', loading: false, error: '' })
  const input = modelDiscoveryInput(harness)
  const model = harness.model
  const key = JSON.stringify([
    connection?.address,
    connection?.token,
    snapshot?.runtimeInstanceId,
    snapshot?.acpInstallations,
    input,
  ])
  const catalog = useSyncExternalStore(
    cachedCatalogs.subscribe,
    () => cachedCatalogs.peek(key),
    () => null,
  )
  useEffect(() => {
    if (!active) return
    let stopped = false
    setState({ key, error: '', loading: connected && !cachedCatalogs.isFresh(key) })
    if (!connected) return
    void cachedCatalogs
      .load(key, async () => {
        const value = await request('/api/agents/models', input, modelCatalogSchema)
        modelLabels.save(connection?.address, harness, value)
        return value
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
  }, [active, connected, request, key])
  return {
    catalog,
    modelName: catalog?.models.find((item) => item.id === model)?.name ?? savedModelName,
    error: state.key === key ? state.error : '',
    loading: active && connected && (state.key !== key || state.loading),
  }
}
