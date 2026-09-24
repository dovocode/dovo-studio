import { Schema } from 'effect'
import { maxValue, minValue, mutableArray, mutableStruct, refine, urlSchema } from './schema.js'

const registryId = refine(
  maxValue(minValue(Schema.String, 1), 100),
  (value) => /^[a-z][a-z0-9-]*$/.test(value),
  'Invalid ACP Registry agent id',
)

export const acpInstallationSchema = mutableStruct({
  id: registryId,
  registryId,
  name: minValue(Schema.String, 1),
  version: minValue(Schema.String, 1),
  distribution: Schema.Literal('binary', 'npx', 'uvx'),
  installedAt: Schema.String,
})
export type AcpInstallation = Schema.Schema.Type<typeof acpInstallationSchema>

/** A registry entry adapted to the current runtime's platform. */
export const acpRegistryAgentSchema = mutableStruct({
  id: registryId,
  name: minValue(Schema.String, 1),
  version: minValue(Schema.String, 1),
  description: Schema.String,
  repository: Schema.optional(urlSchema({ protocol: /^https?$/ })),
  website: Schema.optional(urlSchema({ protocol: /^https?$/ })),
  authors: Schema.optional(mutableArray(Schema.String)),
  license: Schema.optional(Schema.String),
  licenseUrl: Schema.optional(urlSchema({ protocol: /^https?$/ })),
  icon: Schema.optional(urlSchema({ protocol: /^https?$/ })),
  distribution: Schema.Literal('binary', 'npx', 'uvx'),
  available: Schema.Boolean,
  installed: Schema.optional(acpInstallationSchema),
})
export type AcpRegistryAgent = Schema.Schema.Type<typeof acpRegistryAgentSchema>

export const acpRegistryResponseSchema = mutableStruct({
  version: minValue(Schema.String, 1),
  agents: mutableArray(acpRegistryAgentSchema),
  installations: mutableArray(acpInstallationSchema),
})
export type AcpRegistryResponse = Schema.Schema.Type<typeof acpRegistryResponseSchema>

export const acpRegistryInstallSchema = mutableStruct({
  registryId,
})
export const acpRegistryRemoveSchema = mutableStruct({
  id: registryId,
})
