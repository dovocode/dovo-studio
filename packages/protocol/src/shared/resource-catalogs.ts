import { mutableStruct, mutableArray } from './schema.js'
import { maxValue, urlSchema } from './schema.js'
import { Schema } from 'effect'
import { mcpServerSchema } from './resources.js'
export const catalogSearchSchema = mutableStruct({
  query: Schema.optionalWith(maxValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 200), {
    default: () => '',
  }),
  cursor: Schema.optional(maxValue(Schema.String, 1000)),
})
export const skillCatalogEntrySchema = mutableStruct({
  id: Schema.String,
  name: Schema.String,
  source: Schema.String,
  installs: Schema.Number.pipe(Schema.finite()),
  url: urlSchema(),
  supported: Schema.Boolean,
})
export const skillCatalogSchema = mutableStruct({
  entries: mutableArray(skillCatalogEntrySchema),
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
})
export const registryCatalogSchema = mutableStruct({
  entries: mutableArray(registryEntrySchema),
  cursor: Schema.optional(Schema.String),
})
export const skillCatalogImportSchema = mutableStruct({
  revision: Schema.optional(Schema.String.pipe(Schema.pattern(/^[a-f0-9]{40}$/))),
  source: Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)),
  skill: Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]+$/)),
})
export type SkillCatalogEntry = Schema.Schema.Type<typeof skillCatalogEntrySchema>
export type RegistryEntry = Schema.Schema.Type<typeof registryEntrySchema>

/** Only the supported catalog can locate a pinned, portable skill bundle. */
export function catalogSkillSource(skill: { sourceUrl?: string; sourceRevision?: string }) {
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
    return { source, skill: parts[2], revision: skill.sourceRevision }
  } catch {
    return undefined
  }
}
