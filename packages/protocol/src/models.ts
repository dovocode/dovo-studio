import { z } from 'zod'
import { agentSchema } from './workspace.js'
export const agentDiscoverySchema = agentSchema.pick({
  provider: true,
  endpoint: true,
  args: true,
  model: true,
})
const choiceSchema = z.object({ id: z.string(), name: z.string() })
export const modelCatalogSchema = z.object({
  models: z.array(
    choiceSchema.extend({
      description: z.string().optional(),
      hidden: z.boolean().optional(),
      specialty: z.string().optional(),
      defaultReasoning: z.string().optional(),
      defaultServiceTier: z.string().optional(),
      isDefault: z.boolean().optional(),
      serviceTiers: z.array(choiceSchema.extend({ description: z.string().optional() })).optional(),
      reasoning: z.array(choiceSchema).optional(),
    }),
  ),
  reasoning: z.array(choiceSchema),
  codex: z
    .object({
      daybreakPrograms: z.array(z.enum(['daybreakBlue', 'daybreakRed'])),
      fastModeBlocked: z.boolean(),
    })
    .optional(),
})
export type AgentDiscovery = z.infer<typeof agentDiscoverySchema>
export type ModelCatalog = z.infer<typeof modelCatalogSchema>

/** The empty legacy value represented Standard. Send an explicit tier to clear sticky Fast. */
export function serviceTierValue(value: string | undefined) {
  return value || 'default'
}
export function selectedCatalogModel(catalog: ModelCatalog | null | undefined, model: string) {
  return catalog?.models.find((entry) => (model ? entry.id === model : entry.isDefault))
}
export function modelServiceTiers(
  catalog: ModelCatalog | null | undefined,
  model: string,
  saved?: string,
) {
  const tiers = selectedCatalogModel(catalog, model)?.serviceTiers ?? []
  return [
    { id: 'default', name: 'Standard', description: 'Standard speed and usage' },
    ...tiers.filter((tier) => tier.id !== 'default'),
    ...(saved && saved !== 'default' && !tiers.some((tier) => tier.id === saved)
      ? [
          {
            id: saved,
            name: `${saved} (saved)`,
            description: 'Not advertised by the current harness',
          },
        ]
      : []),
  ]
}
export const daybreakLabels = {
  standard: 'Off',
  daybreakBlue: 'Daybreak Blue',
  daybreakRed: 'Daybreak Red',
} as const
export function daybreakChoices(
  catalog: ModelCatalog | null | undefined,
  saved?: keyof typeof daybreakLabels,
) {
  return [
    { id: '', name: 'Automatic' },
    { id: 'standard', name: 'Off' },
    ...(catalog?.codex?.daybreakPrograms ?? []).map((id) => ({ id, name: daybreakLabels[id] })),
    ...(saved && saved !== 'standard' && !catalog?.codex?.daybreakPrograms.includes(saved)
      ? [{ id: saved, name: `${daybreakLabels[saved]} (saved; unavailable)` }]
      : []),
  ]
}
