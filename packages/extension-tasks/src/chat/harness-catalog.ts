import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect } from 'react'
import {
  modelCatalogSchema,
  useWorkspace,
  type TaskHarness,
  type ModelCatalog,
} from '@dovo/studio-core'
export function useHarnessCatalog(harness: TaskHarness, active: boolean) {
  const { request, connected } = useWorkspace()
  const [catalog, setCatalog] = useApplicationState<{
    key: string
    value: ModelCatalog
  } | null>(null)
  const [error, setError] = useApplicationState('')
  const [loading, setLoading] = useApplicationState(false)
  const { provider, endpoint, args, model } = harness
  const argsKey = JSON.stringify(args ?? [])
  const discoveryModel = provider === 'acp' ? model : ''
  const key = JSON.stringify([provider, endpoint, argsKey, discoveryModel])
  useEffect(() => {
    if (!active) return
    let stopped = false
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
      },
      modelCatalogSchema,
    )
      .then((value) => {
        if (!stopped)
          setCatalog({
            key,
            value,
          })
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
  }, [active, provider, endpoint, argsKey, discoveryModel, connected, request, key])
  return {
    catalog: catalog?.key === key ? catalog.value : null,
    error,
    loading,
  }
}
