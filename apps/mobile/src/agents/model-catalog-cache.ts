import { ModelCatalogCache, type ModelCatalogCacheStorage } from '@dovo/client-runtime'
import {
  decodeResult,
  modelCatalogSchema,
  modelCatalogPresentation,
  modelCatalogCacheScope,
  type AgentDiscovery,
  type RuntimeProfile,
  type RuntimeSnapshot,
  type ModelCatalog,
} from '@dovo/protocol'
import type { Runtime } from '../runtime/connection/provider'

export function mobileModelCatalogScope(
  profile: RuntimeProfile | undefined,
  agent: AgentDiscovery,
  snapshot?: RuntimeSnapshot | null,
) {
  return modelCatalogCacheScope(profile?.id, profile?.connection, snapshot, agent)
}
/** String identity is also used by native model-picker draft state. */
export function mobileModelCatalogKey(
  profile: RuntimeProfile | undefined,
  agent: AgentDiscovery,
  snapshot?: RuntimeSnapshot | null,
) {
  return mobileModelCatalogScope(profile, agent, snapshot).key
}
/** Keep streamed task updates from rehashing catalog configuration in every mounted row. */
export function mobileModelCatalogScopeReader(
  profile: RuntimeProfile | undefined,
  agent: AgentDiscovery | undefined,
) {
  let previous: readonly (string | boolean | undefined)[] | undefined
  let scope: ReturnType<typeof mobileModelCatalogScope> | null = null
  return (runtime: Pick<Runtime, 'profile' | 'snapshot' | 'overviews'>) => {
    if (!profile || !agent) return null
    const snapshot =
      profile.id === runtime.profile?.id
        ? runtime.snapshot
        : runtime.overviews.find((entry) => entry.profile.id === profile.id)?.snapshot
    const installation =
      agent.provider === 'acp'
        ? snapshot?.acpInstallations.find((item) => item.id === agent.acpInstallationId)
        : undefined
    const generationId =
      agent.provider === 'acp' && agent.acpInstallationId
        ? `acp:${agent.acpInstallationId}`
        : agent.provider
    const inputs = [
      snapshot?.runtimeId,
      snapshot?.runtimeInstanceId,
      snapshot?.catalogGenerations?.[generationId],
      installation?.version,
      installation?.installedAt,
      installation ? !!installation.needsRepair : undefined,
    ]
    if (!previous || inputs.some((value, index) => value !== previous?.[index])) {
      previous = inputs
      scope = mobileModelCatalogScope(profile, agent, snapshot)
    }
    return scope
  }
}
/** Native storage/crypto adapters share all cache policy with desktop. */
export class MobileModelCatalogCache extends ModelCatalogCache<ModelCatalog> {
  constructor(storage: ModelCatalogCacheStorage, hash: (key: string) => Promise<string>) {
    super({
      storage,
      hash,
      presentation: modelCatalogPresentation,
      decode: (value) => {
        const result = decodeResult(modelCatalogSchema, value)
        return result.success ? result.data : null
      },
    })
  }
}
