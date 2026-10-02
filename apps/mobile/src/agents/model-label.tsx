import type { AgentDiscovery } from '@dovo/protocol'
import { acpHarnessName } from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { harnessNames } from '../tasks/creation/harness-choices'
import { useCachedModelCatalog } from './use-model-catalog'

export function ModelLabel({ agent }: { agent: AgentDiscovery }) {
  const { profile } = useRuntime()
  return useCachedModelCatalog(agent, profile ?? undefined).modelName || 'Provider default model'
}

export function HarnessLabel({ agent }: { agent: AgentDiscovery }) {
  const { profile, snapshot } = useRuntime()
  const { catalog } = useCachedModelCatalog(agent, profile ?? undefined)
  return (
    acpHarnessName(agent, snapshot?.acpInstallations ?? []) ??
    catalog?.harness?.name ??
    harnessNames[agent.provider]
  )
}
