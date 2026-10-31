import { mutableStruct, strictStruct, mutableArray, refine } from '../shared/schema.js'
import { attachmentSchema, MAX_ATTACHMENTS } from '../shared/attachments.js'
import { maxValue, minValue } from '../shared/schema.js'
import { Schema, Effect, Struct } from 'effect'
import { agentSchema, defaultTaskHarness, type Agent, type TaskHarness } from '../workspace.js'
export const titleGenerationSettingsSchema = mutableStruct({
  /** Only used by the Scope/Tune/Maestro selector settings. */
  inheritTitleModel: Schema.optional(Schema.Boolean),
  scopePrompt: Schema.optional(maxValue(Schema.String, 12000)),
  tunePrompt: Schema.optional(maxValue(Schema.String, 12000)),
  maestroPrompt: Schema.optional(maxValue(Schema.String, 12000)),
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
export const generateTitleSchema = refine(
  mutableStruct({
    taskId: Schema.optional(minValue(maxValue(Schema.String, 200), 1)),
    expectedTitle: Schema.optional(maxValue(Schema.String, 1000)),
    text: maxValue(Schema.String.pipe(Schema.decodeTo(Schema.Trim)), 120000),
    attachments: Schema.optional(maxValue(mutableArray(attachmentSchema), MAX_ATTACHMENTS)),
  }),
  (input) => !!input.text || !!input.attachments?.length,
  'Provide text or attachments',
)
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
