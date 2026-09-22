import { z } from 'zod'
import { mcpServerSchema } from './resources.js'
export const catalogSearchSchema = z.object({
  query: z.string().trim().max(200).default(''),
  cursor: z.string().max(1000).optional(),
})
export const skillCatalogEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  source: z.string(),
  installs: z.number(),
  url: z.url(),
  supported: z.boolean(),
})
export const skillCatalogSchema = z.object({ entries: z.array(skillCatalogEntrySchema) })
export const registryVariantSchema = z.object({
  id: z.string(),
  label: z.string(),
  server: mcpServerSchema.optional(),
  notes: z.array(z.string()),
})
export const registryEntrySchema = z.object({
  name: z.string(),
  description: z.string(),
  version: z.string(),
  url: z.url(),
  variants: z.array(registryVariantSchema),
})
export const registryCatalogSchema = z.object({
  entries: z.array(registryEntrySchema),
  cursor: z.string().optional(),
})
export const skillCatalogImportSchema = z.object({
  source: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  skill: z.string().regex(/^[A-Za-z0-9_-]+$/),
})
export type SkillCatalogEntry = z.infer<typeof skillCatalogEntrySchema>
export type RegistryEntry = z.infer<typeof registryEntrySchema>
