import { mutableStruct, mutableArray } from './schema.js'
import { Schema } from 'effect'
import { agentSchema } from './workspace.js'
export const agentDiscoverySchema = agentSchema.pick(
  'provider',
  'endpoint',
  'args',
  'model',
  'acpInstallationId',
  'acpMode',
  'acpConfig',
)
const choiceSchema = mutableStruct({
  id: Schema.String,
  name: Schema.String,
})
export const modelCatalogSchema = mutableStruct({
  models: mutableArray(
    mutableStruct({
      ...choiceSchema.fields,
      ...{
        description: Schema.optional(Schema.String),
        hidden: Schema.optional(Schema.Boolean),
        specialty: Schema.optional(Schema.String),
        defaultReasoning: Schema.optional(Schema.String),
        defaultServiceTier: Schema.optional(Schema.String),
        isDefault: Schema.optional(Schema.Boolean),
        serviceTiers: Schema.optional(
          mutableArray(
            mutableStruct({
              ...choiceSchema.fields,
              ...{
                description: Schema.optional(Schema.String),
              },
            }),
          ),
        ),
        reasoning: Schema.optional(mutableArray(choiceSchema)),
      },
    }),
  ),
  reasoning: mutableArray(choiceSchema),
  acp: Schema.optional(
    mutableStruct({
      modes: mutableArray(choiceSchema),
      configOptions: mutableArray(
        mutableStruct({
          ...choiceSchema.fields,
          category: Schema.optional(Schema.String),
          currentValue: Schema.String,
          options: mutableArray(choiceSchema),
        }),
      ),
      commands: mutableArray(
        mutableStruct({
          name: Schema.String,
          description: Schema.String,
          inputHint: Schema.optional(Schema.String),
        }),
      ),
    }),
  ),
  codex: Schema.optional(
    mutableStruct({
      daybreakPrograms: mutableArray(Schema.Literal('daybreakBlue', 'daybreakRed')),
      fastModeBlocked: Schema.Boolean,
    }),
  ),
})
export type AgentDiscovery = Schema.Schema.Type<typeof agentDiscoverySchema>
export type ModelCatalog = Schema.Schema.Type<typeof modelCatalogSchema>

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
    {
      id: 'default',
      name: 'Standard',
      description: 'Standard speed and usage',
    },
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
    {
      id: '',
      name: 'Automatic',
    },
    {
      id: 'standard',
      name: 'Off',
    },
    ...(catalog?.codex?.daybreakPrograms ?? []).map((id) => ({
      id,
      name: daybreakLabels[id],
    })),
    ...(saved && saved !== 'standard' && !catalog?.codex?.daybreakPrograms.includes(saved)
      ? [
          {
            id: saved,
            name: `${daybreakLabels[saved]} (saved; unavailable)`,
          },
        ]
      : []),
  ]
}
