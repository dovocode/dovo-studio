import { mutableStruct, strictStruct } from '../shared/schema.js'
import { maxValue, minValue } from '../shared/schema.js'
import { Schema, Effect, Struct } from 'effect'
import { agentSchema, defaultTaskHarness, type Agent, type TaskHarness } from '../workspace.js'
export const titleGenerationSettingsSchema = mutableStruct({
  harness: Schema.optional(
    agentSchema.mapFields(
      Struct.pick([
        'provider',
        'endpoint',
        'args',
        'env',
        'executablePath',
        'configDirectory',
        'acpInstallationId',
      ]),
    ),
  ),
  agentId: maxValue(Schema.String, 200).pipe(Schema.withDecodingDefaultType(Effect.sync(() => ''))),
  model: maxValue(Schema.String, 300).pipe(Schema.withDecodingDefaultType(Effect.sync(() => ''))),
  reasoning: maxValue(Schema.String, 100).pipe(
    Schema.withDecodingDefaultType(Effect.sync(() => '')),
  ),
})
export const generateTitleSchema = mutableStruct({
  text: maxValue(minValue(Schema.String.pipe(Schema.decodeTo(Schema.Trim)), 1), 120000),
})
export const generatedTitleSchema = mutableStruct({
  title: maxValue(minValue(Schema.String.pipe(Schema.decodeTo(Schema.Trim)), 1), 120),
})
export const cleanupDictationSchema = strictStruct({
  text: maxValue(minValue(Schema.String.pipe(Schema.decodeTo(Schema.Trim)), 1), 12000),
})
export const cleanedDictationSchema = strictStruct({
  text: maxValue(minValue(Schema.String.pipe(Schema.decodeTo(Schema.Trim)), 1), 16000),
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
        env: taskDefault.env,
        executablePath: taskDefault.executablePath,
        configDirectory: taskDefault.configDirectory,
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
      env: agent.env,
      executablePath: agent.executablePath,
      configDirectory: agent.configDirectory,
      acpInstallationId: agent.acpInstallationId,
    },
    model: agent.model,
    reasoning: agent.reasoning ?? '',
  }
}
