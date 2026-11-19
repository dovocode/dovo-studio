import { modelDisplayName } from './model-display-name.js'
export { modelDisplayName } from './model-display-name.js'
import { mutableStruct, mutableArray } from '../shared/schema.js'
import { Schema, Struct } from 'effect'
import { agentSchema, type TaskHarness } from '../workspace.js'
export const agentDiscoverySchema = agentSchema.mapFields(
  Struct.pick([
    'provider',
    'endpoint',
    'executablePath',
    'configDirectory',
    'args',
    'env',
    'envSecrets',
    'model',
    'acpInstallationId',
    'acpMode',
    'acpConfig',
  ]),
)
const choiceSchema = mutableStruct({
  id: Schema.String,
  name: Schema.String,
})
export const modelCatalogSchema = mutableStruct({
  harness: Schema.optional(
    mutableStruct({
      name: Schema.String,
      generation: Schema.Literals(['v1', 'v2']),
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
      daybreakPrograms: mutableArray(Schema.Literals(['daybreakBlue', 'daybreakRed'])),
      fastModeBlocked: Schema.Boolean,
    }),
  ),
})
export type AgentDiscovery = Schema.Schema.Type<typeof agentDiscoverySchema>
export type ModelCatalog = Schema.Schema.Type<typeof modelCatalogSchema>

/** ACP advertises these settings in the same controls as built-in providers. */
export function acpModelSetting(option: { id: string; category?: string | null }) {
  if (option.category === 'model' || (!option.category && option.id === 'model')) return 'model'
  if (option.category === 'thought_level') return 'reasoning'
  return undefined
}

/** Clear older ACP overrides when the user chooses a model or reasoning level. */
export function changeModelSettings<T extends TaskHarness>(
  harness: T,
  selection: { model: string } | { reasoning: string },
  catalog: ModelCatalog | null | undefined,
): T {
  const model = 'model' in selection ? selection.model : harness.model
  const changedModel = model !== harness.model
  const reasoning =
    'reasoning' in selection ? selection.reasoning : changedModel ? '' : harness.reasoning
  const config = harness.acpConfig
  const primary = catalog?.acp?.configOptions.filter((option) => {
    const setting = acpModelSetting(option)
    return setting === 'reasoning' || (setting === 'model' && 'model' in selection)
  })
  return {
    ...harness,
    model,
    reasoning,
    serviceTier: changedModel ? undefined : harness.serviceTier,
    cyberAccessProgram: changedModel ? undefined : harness.cyberAccessProgram,
    ...(harness.provider === 'acp' && config && primary?.length
      ? {
          acpConfig: Object.fromEntries(
            Object.entries(config).filter(([id]) => !primary.some((option) => option.id === id)),
          ),
        }
      : {}),
  }
}

/** Model pickers show concrete models, while saved provider defaults remain valid. */
export function isNamedModelId(id: string) {
  const value = id.trim().toLowerCase()
  return value !== '' && value !== 'default'
}

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
    ...(agent.envSecrets
      ? {
          envSecrets: Object.fromEntries(
            Object.entries(agent.envSecrets).sort(([a], [b]) => a.localeCompare(b)),
          ),
        }
      : {}),
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
export function modelReasoningLevels(catalog: ModelCatalog | null | undefined, model: string) {
  const selected = selectedCatalogModel(catalog, model)
  return (
    selected?.reasoning ?? (!model || selected?.isDefault ? catalog?.reasoning : undefined) ?? []
  )
}

export function isFastServiceTier(tier: string | undefined) {
  return tier === 'fast' || tier === 'priority'
}

export function modelServiceTiers(
  catalog: ModelCatalog | null | undefined,
  model: string,
  saved?: string,
): Array<{ id: string; name: string; description?: string; disabled?: boolean }> {
  const tiers = (selectedCatalogModel(catalog, model)?.serviceTiers ?? []).filter(
    (tier) => !catalog?.codex?.fastModeBlocked || !isFastServiceTier(tier.id),
  )
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
            disabled: true,
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
