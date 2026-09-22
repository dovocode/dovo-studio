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
  const { request, connected } = useWorkspace()
  const load = useCallback(
    (input: AgentDiscovery) => request('/api/agents/models', input, modelCatalogSchema),
    [request],
  )
  return <Fields agent={agent} onChange={onChange} connected={connected} loadModels={load} />
}
