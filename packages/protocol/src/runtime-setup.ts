import { Schema } from 'effect'
import { mutableStruct } from './schema.js'
import { defaultTaskHarness, taskHarnessSchema } from './workspace.js'
import { titleGenerationSettingsSchema } from './title-generation.js'

export const runtimeDefaultsSchema = mutableStruct({
  configured: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  harness: Schema.optionalWith(
    taskHarnessSchema
      .omit('resources')
      .annotations({ parseOptions: { onExcessProperty: 'error' } }),
    { default: () => defaultTaskHarness('codex') },
  ),
})
export const runtimeSetupSchema = mutableStruct({
  defaults: runtimeDefaultsSchema,
  titles: titleGenerationSettingsSchema,
})
export type RuntimeDefaults = Schema.Schema.Type<typeof runtimeDefaultsSchema>
export type RuntimeSetup = Schema.Schema.Type<typeof runtimeSetupSchema>
