import { mutableStruct, mutableArray } from './schema.js'
import { maxValue, minValue, urlSchema } from './schema.js'
import { Schema, Effect } from 'effect'
import { mcpServerSchema, managedSkillSchema } from './resources.js'
export const mcpRegistrySources = [
  { id: 'official', name: 'Official MCP Registry' },
  { id: 'glama', name: 'Glama' },
  { id: 'smithery', name: 'Smithery' },
] as const
export const mcpRegistrySourceSchema = Schema.Literals(['official', 'glama', 'smithery'])
export type McpRegistrySource = typeof mcpRegistrySourceSchema.Type
export const catalogSearchSchema = mutableStruct({
  query: maxValue(Schema.String.pipe(Schema.decodeTo(Schema.Trim)), 200).pipe(
    Schema.withDecodingDefaultType(Effect.sync(() => '')),
  ),
  cursor: Schema.optional(maxValue(Schema.String, 1000)),
  source: Schema.optional(mcpRegistrySourceSchema),
  server: Schema.optional(maxValue(Schema.String, 300)),
  view: Schema.optional(Schema.Literals(['search', 'all-time', 'trending', 'hot'])),
})
export const skillCatalogEntrySchema = mutableStruct({
  id: Schema.String,
  name: Schema.String,
  source: Schema.String,
  installs: Schema.optional(
    Schema.Number.pipe(
      Schema.check(Schema.isFinite()),
      Schema.check(Schema.isGreaterThanOrEqualTo(0)),
    ),
  ),
  installsPeriod: Schema.optional(Schema.Literals(['all-time', '24h'])),
  url: urlSchema(),
  supported: Schema.Boolean,
})
export const skillCatalogSchema = mutableStruct({
  entries: mutableArray(skillCatalogEntrySchema),
  cursor: Schema.optional(Schema.String),
})
export const registryVariantSchema = mutableStruct({
  id: Schema.String,
  label: Schema.String,
  server: Schema.optional(mcpServerSchema),
  notes: mutableArray(Schema.String),
})
export const registryEntrySchema = mutableStruct({
  name: Schema.String,
  description: Schema.String,
  version: Schema.String,
  url: urlSchema(),
  variants: mutableArray(registryVariantSchema),
  updatedAt: Schema.optional(Schema.String),
  provider: Schema.optional(Schema.Literals(['official', 'glama', 'smithery'])),
  providerId: Schema.optional(Schema.String),
  uses: Schema.optional(
    Schema.Number.pipe(
      Schema.check(Schema.isFinite()),
      Schema.check(Schema.isGreaterThanOrEqualTo(0)),
    ),
  ),
  verified: Schema.optional(Schema.Boolean),
  qualityScore: Schema.optional(
    Schema.Number.pipe(
      Schema.check(Schema.isGreaterThanOrEqualTo(0)),
      Schema.check(Schema.isLessThanOrEqualTo(5)),
    ),
  ),
  promoted: Schema.optional(Schema.Boolean),
})
export const registryCatalogSchema = mutableStruct({
  entries: mutableArray(registryEntrySchema),
  cursor: Schema.optional(Schema.String),
})
export const skillCatalogImportSchema = mutableStruct({
  package: Schema.optional(Schema.Boolean),
  revision: Schema.optional(Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{40}$/)))),
  source: Schema.String.pipe(Schema.check(Schema.isPattern(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/))),
  skill: Schema.String.pipe(Schema.check(Schema.isPattern(/^[A-Za-z0-9_-]+$/))),
})
export const skillPackageImportSchema = mutableStruct({
  ...skillCatalogImportSchema.fields,
  skills: minValue(maxValue(mutableArray(managedSkillSchema.fields.name), 20), 1),
})
export const skillPackageSchema = mutableStruct({
  source: skillCatalogImportSchema.fields.source,
  revision: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{40}$/))),
  skills: mutableArray(managedSkillSchema),
})
export type SkillPackage = Schema.Schema.Type<typeof skillPackageSchema>
export type SkillCatalogEntry = Schema.Schema.Type<typeof skillCatalogEntrySchema>
export type RegistryEntry = Schema.Schema.Type<typeof registryEntrySchema>

/** Only the supported catalog can locate a pinned, portable skill bundle. */
export function catalogSkillSource(skill: {
  sourceUrl?: string
  sourceRevision?: string
  sourcePackage?: boolean
}) {
  if (!skill.sourceUrl || !skill.sourceRevision || !/^[a-f0-9]{40}$/.test(skill.sourceRevision))
    return undefined
  try {
    const url = new URL(skill.sourceUrl)
    if (url.protocol !== 'https:' || url.hostname !== 'skills.sh' || url.username || url.password)
      return undefined
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.length !== 3) return undefined
    const source = `${parts[0]}/${parts[1]}`
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source) || !/^[A-Za-z0-9_-]+$/.test(parts[2]))
      return undefined
    return {
      source,
      skill: parts[2],
      revision: skill.sourceRevision,
      ...(skill.sourcePackage ? { package: true } : {}),
    }
  } catch {
    return undefined
  }
}

/** These controls sort only the entries already loaded from the provider. */
export const catalogSortOptions = {
  mcp: [
    { id: 'provider', name: 'Registry order' },
    { id: 'name', name: 'Name A–Z' },
    { id: 'updated', name: 'Recently updated' },
    { id: 'uses', name: 'Most uses' },
    { id: 'quality', name: 'Tool quality' },
  ],
  skill: [
    { id: 'provider', name: 'Provider order' },
    { id: 'installs', name: 'Most installs' },
    { id: 'name', name: 'Name A–Z' },
  ],
}
export function sortCatalogEntries<
  T extends {
    name: string
    installs?: number
    updatedAt?: string
    uses?: number
    qualityScore?: number
  },
>(entries: readonly T[], sort: string): T[] {
  return [...entries].sort((a, b) =>
    sort === 'name'
      ? a.name.localeCompare(b.name)
      : sort === 'uses'
        ? (b.uses ?? -1) - (a.uses ?? -1)
        : sort === 'quality'
          ? (b.qualityScore ?? -1) - (a.qualityScore ?? -1)
          : sort === 'installs'
            ? (b.installs ?? -1) - (a.installs ?? -1)
            : sort === 'updated'
              ? (Date.parse(b.updatedAt ?? '') || 0) - (Date.parse(a.updatedAt ?? '') || 0)
              : 0,
  )
}
export function skillInstallLabel(entry: SkillCatalogEntry) {
  return entry.installs === undefined
    ? 'Install count unavailable'
    : `${entry.installs.toLocaleString()} installs${entry.installsPeriod === '24h' ? ' in 24h' : ''}`
}

export function registrySignals(entry: RegistryEntry): string[] {
  return [
    entry.uses === undefined
      ? 'Usage count unavailable'
      : `${entry.uses.toLocaleString()} uses on Smithery`,
    entry.verified === undefined
      ? 'Safety not assessed'
      : entry.verified
        ? 'Verified by Smithery · Not a security audit'
        : 'Not verified by Smithery',
    ...(entry.qualityScore === undefined
      ? []
      : [`Glama tool quality: ${entry.qualityScore}/5 · Not a safety score`]),
    ...(entry.promoted ? ['Promoted on Glama'] : []),
  ]
}
