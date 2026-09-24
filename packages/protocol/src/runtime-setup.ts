import { Schema } from 'effect'
import { mutableStruct } from './schema.js'
import {
  defaultTaskHarness,
  taskHarnessSchema,
  projectTaskDefaultsSchema,
  type Repository,
} from './workspace.js'
import { titleGenerationSettingsSchema } from './title-generation.js'

export const runtimeDefaultsSchema = mutableStruct({
  setupCommand: projectTaskDefaultsSchema.fields.setupCommand,
  execution: projectTaskDefaultsSchema.fields.execution,
  worktreeBaseBranch: projectTaskDefaultsSchema.fields.worktreeBaseBranch,
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

/** Copy these settings into a new task; later changes never mutate existing conversations. */
export function resolveTaskDefaults(
  runtime: RuntimeDefaults | undefined,
  repository: Repository | undefined,
) {
  return {
    setupCommand: repository?.taskDefaults?.setupCommand ?? runtime?.setupCommand,
    harness: repository?.taskDefaults?.harness ?? runtime?.harness ?? defaultTaskHarness('codex'),
    execution: repository?.taskDefaults?.execution ?? runtime?.execution ?? 'main',
    worktreeBaseBranch: repository?.taskDefaults?.worktreeBaseBranch ?? runtime?.worktreeBaseBranch,
  }
}
