import { runtimeDefaultsSchema } from '@dovo/protocol'
import { useCallback } from 'react'
import {
  modelCatalogSchema,
  type Agent,
  type AgentDiscovery,
  useWorkspace,
} from '@dovo/studio-core'
import { ModelSettings as Fields } from '@dovo/studio-ui'
export function ModelSettings({
  agent,
  onChange,
}: {
  agent: Agent
  onChange: (agent: Agent) => void
}) {
  const { request, connected, snapshot, refreshRuntimes } = useWorkspace()
  const load = useCallback(
    (input: AgentDiscovery) => request('/api/agents/models', input, modelCatalogSchema),
    [request],
  )
  return (
    <Fields
      agent={agent}
      onChange={onChange}
      connected={connected}
      loadModels={load}
      preferences={snapshot?.defaults?.modelPreferences}
      onPreference={async (key, change) => {
        await request('/api/agents/models/preference', { key, ...change }, runtimeDefaultsSchema)
        await refreshRuntimes()
      }}
    />
  )
}
