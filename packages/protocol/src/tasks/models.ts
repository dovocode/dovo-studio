import { modelDisplayName } from './model-display-name.js'
export { modelDisplayName } from './model-display-name.js'
import { mutableStruct, mutableArray } from '../shared/schema.js'
import { Schema } from 'effect'
import { agentSchema } from '../workspace.js'
export const agentDiscoverySchema = agentSchema.pick(
  'provider',
  'endpoint',
  'executablePath',
  'configDirectory',
  'args',
  'env',
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
  harness: Schema.optional(
    mutableStruct({
      name: Schema.String,
      generation: Schema.Literal('v1', 'v2'),
    }),
  ),
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

export function modelCatalogChoices(models: ModelCatalog['models']) {
  const names = models.map((model) => modelDisplayName(model.id, model.name))
  const counts = new Map<string, number>()
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
  return models.map((model, index) => ({
    ...model,
    name:
      (counts.get(names[index]) ?? 0) > 1
        ? `${names[index]} · ${model.id.includes('/') ? model.id.slice(0, model.id.indexOf('/')) : model.id}`
        : names[index],
  }))
}

/** Model lists depend on launch settings and account, not the selected non-ACP model. */
export function modelDiscoveryInput(agent: AgentDiscovery): AgentDiscovery {
  const sorted = (values: Record<string, string> | undefined) =>
    Object.fromEntries(Object.entries(values ?? {}).sort(([a], [b]) => a.localeCompare(b)))
  return {
    provider: agent.provider,
    endpoint: agent.endpoint,
    executablePath: agent.executablePath,
    configDirectory: agent.configDirectory,
    args: agent.args ?? [],
    env: sorted(agent.env),
    model: ['acp', 'grok'].includes(agent.provider) ? agent.model : '',
    ...(agent.provider === 'acp'
      ? {
          acpInstallationId: agent.acpInstallationId,
          acpMode: agent.acpMode,
          acpConfig: sorted(agent.acpConfig),
        }
      : {}),
  }
}

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

/** Stable identities keep ACP models from different installations separate. */
export function modelPreferenceKey(provider: string, model: string, installationId?: string) {
  return `${provider}:${installationId ? `${installationId}:` : ''}${model}`
}
