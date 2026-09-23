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
  source: Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)),
  skill: Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]+$/)),
})
export type SkillCatalogEntry = Schema.Schema.Type<typeof skillCatalogEntrySchema>
export type RegistryEntry = Schema.Schema.Type<typeof registryEntrySchema>
