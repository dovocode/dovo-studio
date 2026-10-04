import { Schema } from 'effect'
import { mutableArray, mutableStruct } from '../shared/schema.js'
import { defaultTaskHarness, providerSchema, type Agent, type TaskHarness } from '../workspace.js'
import { acpHarnessChoiceId, acpInstallationHarness } from './acp-harness.js'
import type { AcpInstallation } from '../auth/acp-registry.js'

export const harnessAvailabilitySchema = mutableArray(
  mutableStruct({ id: Schema.String, available: Schema.Boolean }),
)
export type HarnessAvailability = Schema.Schema.Type<typeof harnessAvailabilitySchema>

export function harnessChoiceId(harness: Pick<TaskHarness, 'provider' | 'acpInstallationId'>) {
  return harness.provider === 'acp' && harness.acpInstallationId
    ? acpHarnessChoiceId(harness.acpInstallationId)
    : `harness:${harness.provider}`
}

export function harnessAvailabilityCandidates(
  agents: readonly Agent[],
  installations: readonly AcpInstallation[],
) {
  return [
    ...providerSchema.literals.map((provider) => ({
      id: `harness:${provider}`,
      agent: { ...defaultTaskHarness(provider), id: 'availability', name: provider },
    })),
    ...installations.map((installation) => ({
      id: acpHarnessChoiceId(installation.id),
      agent: {
        ...acpInstallationHarness(installation),
        id: 'availability',
        name: installation.name,
      },
    })),
    ...agents.map((agent) => ({ id: `agent:${agent.id}`, agent })),
  ]
}
