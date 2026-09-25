import { decodeResult, mutableArray, mutableStruct } from '@dovo/protocol'
import { Schema } from 'effect'
import { valid as semverValid } from 'semver'

export const REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json'

const boundedString = (max: number) => Schema.String.pipe(Schema.maxLength(max))
const argSchema = boundedString(4096)
const argsSchema = mutableArray(argSchema)
const environmentSchema = Schema.Record({
  key: boundedString(256),
  value: boundedString(4096),
})
const optionalEnvironment = Schema.optional(environmentSchema)
const binaryTargetSchema = mutableStruct({
  archive: boundedString(4096),
  sha256: Schema.optional(boundedString(64)),
  cmd: boundedString(4096),
  args: Schema.optional(argsSchema),
  env: optionalEnvironment,
})
const packageDistributionSchema = mutableStruct({
  package: boundedString(4096),
  args: Schema.optional(argsSchema),
  env: optionalEnvironment,
})
const distributionSchema = mutableStruct({
  binary: Schema.optional(Schema.Record({ key: Schema.String, value: binaryTargetSchema })),
  npx: Schema.optional(packageDistributionSchema),
  uvx: Schema.optional(packageDistributionSchema),
})
const registryEntrySchema = mutableStruct({
  id: boundedString(100),
  name: boundedString(500),
  version: boundedString(100),
  description: boundedString(20_000),
  repository: Schema.optional(boundedString(4096)),
  website: Schema.optional(boundedString(4096)),
  authors: Schema.optional(mutableArray(boundedString(500))),
  license: Schema.optional(boundedString(500)),
  license_url: Schema.optional(boundedString(4096)),
  icon: Schema.optional(boundedString(4096)),
  distribution: distributionSchema,
})
const registryEnvelopeSchema = mutableStruct({
  version: boundedString(100),
  agents: mutableArray(Schema.Unknown),
})

export type RegistryEntry = Schema.Schema.Type<typeof registryEntrySchema>
export type BinaryTarget = Schema.Schema.Type<typeof binaryTargetSchema>
export type PackageDistribution = Schema.Schema.Type<typeof packageDistributionSchema>
export type Distribution =
  | { kind: 'binary'; value: BinaryTarget }
  | { kind: 'npx'; value: PackageDistribution }
  | { kind: 'uvx'; value: PackageDistribution }

export type RegistryPlatform =
  | 'darwin-aarch64'
  | 'darwin-x86_64'
  | 'linux-aarch64'
  | 'linux-x86_64'
  | 'windows-aarch64'
  | 'windows-x86_64'

export function parseRegistryResponse(raw: unknown) {
  const envelope = decodeResult(registryEnvelopeSchema, raw)
  if (!envelope.success || !validRegistryVersion(envelope.data.version))
    throw new Error('ACP Registry returned an unsupported response')
  if (!envelope.data.version.startsWith('1.'))
    throw new Error(`ACP Registry version ${envelope.data.version} is not supported`)
  const agents: RegistryEntry[] = []
  for (const candidate of envelope.data.agents) {
    const parsed = decodeResult(registryEntrySchema, candidate)
    if (
      !parsed.success ||
      !/^[a-z][a-z0-9-]*$/.test(parsed.data.id) ||
      !validRegistryVersion(parsed.data.version)
    )
      continue
    agents.push(parsed.data)
  }
  return { version: envelope.data.version, agents }
}

export function platformKey(platform: NodeJS.Platform, arch: string): RegistryPlatform | undefined {
  const os =
    platform === 'darwin'
      ? 'darwin'
      : platform === 'linux'
        ? 'linux'
        : platform === 'win32'
          ? 'windows'
          : undefined
  const cpu = arch === 'arm64' ? 'aarch64' : arch === 'x64' ? 'x86_64' : undefined
  return os && cpu ? (`${os}-${cpu}` as RegistryPlatform) : undefined
}

export function publicUrl(value: string | undefined) {
  if (!value) return undefined
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : undefined
  } catch {
    return undefined
  }
}

export function selectedDistribution(
  entry: RegistryEntry,
  target: RegistryPlatform | undefined,
): Distribution | undefined {
  const binary = target ? entry.distribution.binary?.[target] : undefined
  if (binary) return { kind: 'binary', value: binary }
  if (entry.distribution.npx) return { kind: 'npx', value: entry.distribution.npx }
  if (entry.distribution.uvx) return { kind: 'uvx', value: entry.distribution.uvx }
  if (entry.distribution.binary && Object.keys(entry.distribution.binary).length)
    return { kind: 'binary', value: Object.values(entry.distribution.binary)[0]! }
  return undefined
}

export function distributionAvailable(entry: RegistryEntry, target: RegistryPlatform | undefined) {
  return !!(
    (target && entry.distribution.binary?.[target]) ||
    entry.distribution.npx ||
    entry.distribution.uvx
  )
}

function validRegistryVersion(value: string) {
  return semverValid(value) === value
}
