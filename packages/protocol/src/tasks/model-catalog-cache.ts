import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import type { RuntimeConnection, RuntimeSnapshot } from '../runtime/connection/runtime.js'
import { decode } from '../shared/schema.js'
import {
  modelCatalogSchema,
  modelDiscoveryInput,
  type AgentDiscovery,
  type ModelCatalog,
} from './models.js'

/** Display metadata is never evidence of authentication, permissions or account entitlements. */
export function modelCatalogPresentation(catalog: ModelCatalog): ModelCatalog {
  return decode(modelCatalogSchema, {
    models: catalog.models,
    reasoning: catalog.reasoning,
    ...(catalog.harness ? { harness: catalog.harness } : {}),
  })
}

/** Pure SHA256 also works on HTTP LAN/VPN connections without secure-context WebCrypto. */
export function modelCatalogCacheScope(
  runtimeId: string | undefined | null,
  connection: RuntimeConnection | undefined | null,
  snapshot: RuntimeSnapshot | undefined | null,
  agent: AgentDiscovery,
): { key: string; presentationKey: string } {
  const logicalId = snapshot?.runtimeId || connection?.runtimeId || runtimeId
  const runtime = logicalId
    ? ['runtime', logicalId]
    : ['legacy', connection?.address, connection?.token]
  const installation =
    agent.provider === 'acp'
      ? snapshot?.acpInstallations.find((item) => item.id === agent.acpInstallationId)
      : undefined
  const generationId =
    agent.provider === 'acp' && agent.acpInstallationId
      ? `acp:${agent.acpInstallationId}`
      : agent.provider
  const discovery = modelDiscoveryInput(agent)
  const digest = (value: unknown) => bytesToHex(sha256(utf8ToBytes(JSON.stringify(value))))
  const presentationKey = digest([
    'model-catalog-v1',
    runtime,
    discovery,
    snapshot?.catalogGenerations?.[generationId],
    installation
      ? [installation.version, installation.installedAt, !!installation.needsRepair]
      : null,
  ])
  return {
    presentationKey,
    key: digest([presentationKey, snapshot?.runtimeInstanceId]),
  }
}
