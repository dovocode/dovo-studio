import { mutableStruct } from './schema.js'
import { maxValue, minValue } from './schema.js'
import { Schema } from 'effect'
import { agentSchema, defaultTaskHarness, type Agent, type TaskHarness } from './workspace.js'
export const titleGenerationSettingsSchema = mutableStruct({
  harness: Schema.optional(agentSchema.pick('provider', 'endpoint', 'args', 'acpInstallationId')),
  agentId: Schema.optionalWith(maxValue(Schema.String, 200), {
    default: () => '',
  }),
  model: Schema.optionalWith(maxValue(Schema.String, 300), {
    default: () => '',
  }),
  reasoning: Schema.optionalWith(maxValue(Schema.String, 100), {
    default: () => '',
  }),
})
export const generateTitleSchema = mutableStruct({
  text: maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 120000),
})
export const generatedTitleSchema = mutableStruct({
  title: maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 120),
})
export const cleanupDictationSchema = mutableStruct({
  text: maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 12000),
}).annotations({
  parseOptions: {
    onExcessProperty: 'error',
  },
})
export const cleanedDictationSchema = mutableStruct({
  text: maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 16000),
}).annotations({
  parseOptions: {
    onExcessProperty: 'error',
  },
})
export type TitleGenerationSettings = Schema.Schema.Type<typeof titleGenerationSettingsSchema>

/** Utility model selection is independent of the task model, even when sharing its provider. */
export function resolveTitleHarness(
  settings: TitleGenerationSettings,
  agents: readonly Agent[],
  taskDefault?: TaskHarness,
): Agent | undefined {
  if (settings.harness)
    return {
      ...defaultTaskHarness(settings.harness.provider),
      ...settings.harness,
      id: 'title-harness',
      name: settings.harness.provider,
    }
  if (settings.agentId) return agents.find((agent) => agent.id === settings.agentId)
  return taskDefault
    ? {
        ...defaultTaskHarness(taskDefault.provider),
        endpoint: taskDefault.endpoint,
        args: taskDefault.args,
        acpInstallationId: taskDefault.acpInstallationId,
        id: 'title-harness',
        name: taskDefault.provider,
      }
    : (agents[0] ?? { ...defaultTaskHarness('codex'), id: 'title-harness', name: 'Codex' })
}

export function titleSettingsForHarness(agent: Agent): TitleGenerationSettings {
  return {
    agentId: '',
    harness: {
      provider: agent.provider,
      endpoint: agent.endpoint,
      args: agent.args,
      acpInstallationId: agent.acpInstallationId,
    },
    model: agent.model,
    reasoning: agent.reasoning ?? '',
  }
}
