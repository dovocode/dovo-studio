import { createModelLabels } from './model-labels'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect } from 'react'
import {
  modelCatalogSchema,
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
const cachedCatalogs = new Map<string, { value: ModelCatalog; expires: number }>()
export function useHarnessCatalog(harness: TaskHarness, active: boolean) {
  const { request, connected, connection } = useWorkspace()
  const [catalog, setCatalog] = useApplicationState<{
    key: string
    value: ModelCatalog
  } | null>(null)
  const [error, setError] = useApplicationState('')
  const [loading, setLoading] = useApplicationState(false)
  const { provider, endpoint, args, model, acpInstallationId, acpMode, acpConfig } = harness
  const argsKey = JSON.stringify(args ?? [])
  const discoveryModel = provider === 'acp' ? model : ''
  const key = JSON.stringify([
    connection?.address,
    connection?.token,
    provider,
    endpoint,
    argsKey,
    discoveryModel,
    acpInstallationId,
    acpMode,
    acpConfig,
  ])
  useEffect(() => {
    if (!active) return
    let stopped = false
    const cached = cachedCatalogs.get(key)
    if (cached && cached.expires > Date.now()) {
      setCatalog({ key, value: cached.value })
      setError('')
      setLoading(false)
      return
    }
    setCatalog(null)
    setError('')
    setLoading(connected)
    if (!connected) return
    void request(
      '/api/agents/models',
      {
        provider,
        endpoint,
        args: JSON.parse(argsKey),
        model: discoveryModel,
        acpInstallationId,
        acpMode,
        acpConfig,
      },
      modelCatalogSchema,
    )
      .then((value) => {
        if (!stopped) {
          modelLabels.save(connection?.address, harness, value)
          cachedCatalogs.delete(key)
          cachedCatalogs.set(key, { value, expires: Date.now() + 5 * 60_000 })
          if (cachedCatalogs.size > 64) {
            const oldest = cachedCatalogs.keys().next().value
            if (oldest !== undefined) cachedCatalogs.delete(oldest)
          }
          setCatalog({
            key,
            value,
          })
        }
      })
      .catch((error) => {
        if (!stopped) setError(String(error))
      })
      .finally(() => {
        if (!stopped) setLoading(false)
      })
    return () => {
      stopped = true
    }
  }, [
    active,
    provider,
    endpoint,
    argsKey,
    discoveryModel,
    acpInstallationId,
    acpMode,
    acpConfig,
    connected,
    request,
    key,
  ])
  return {
    catalog: catalog?.key === key ? catalog.value : (cachedCatalogs.get(key)?.value ?? null),
    modelName:
      (catalog?.key === key ? catalog.value : cachedCatalogs.get(key)?.value)?.models.find(
        (item) => item.id === model,
      )?.name ?? modelLabels.get(connection?.address, harness),
    error,
    loading,
  }
}
