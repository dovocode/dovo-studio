import { Schema } from 'effect'
import { mutableStruct } from '../../shared/schema.js'
import {
  defaultTaskHarness,
  agentSchema,
  taskHarnessSchema,
  projectTaskDefaultsSchema,
  scopedSettingsSchema,
  type Repository,
} from '../../workspace.js'
import { titleGenerationSettingsSchema } from '../../tasks/title-generation.js'
import { resolveScopedSettings } from './scoped-settings.js'
import { resolveProviderAccess } from '../../auth/access.js'

export const modelPreferencesSchema = Schema.Record({
  key: Schema.String,
  value: mutableStruct({ favorite: Schema.Boolean, disabled: Schema.Boolean }),
})
export const runtimeDefaultsSchema = mutableStruct({
  scopedSettings: Schema.optional(scopedSettingsSchema),
  globalModelPreferencesUpdatedAt: Schema.optional(Schema.Number),
  globalModelPreferences: Schema.optional(modelPreferencesSchema),
  modelPreferenceOverrides: Schema.optional(modelPreferencesSchema),
  modelPreferences: Schema.optional(modelPreferencesSchema),
  setupCommand: projectTaskDefaultsSchema.fields.setupCommand,
  execution: projectTaskDefaultsSchema.fields.execution,
  worktreeFromOrigin: projectTaskDefaultsSchema.fields.worktreeFromOrigin,
  permission: Schema.optionalWith(agentSchema.fields.permission, {
    default: () => 'full-access' as const,
  }),
  configured: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  // Ignore unknown keys like the rest of the protocol: a newer runtime's extra field must
  // not break an older client's snapshot, nor a downgraded runtime's stored defaults.
  harness: Schema.optionalWith(taskHarnessSchema.omit('resources'), {
    default: () => defaultTaskHarness('codex'),
  }),
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
  const defaults = resolveScopedSettings(runtime, repository).taskDefaults ?? {}
  const selected = defaults.harness ?? defaultTaskHarness('codex')
  const permission = defaults.permission ?? 'full-access'
  return {
    setupCommand: repository?.kind ? undefined : defaults.setupCommand,
    ...(defaults.submodules && !repository?.kind ? { submodules: defaults.submodules } : {}),
    harness: {
      ...selected,
      permission: resolveProviderAccess(selected.provider, permission),
    },
    execution: repository?.kind ? ('main' as const) : (defaults.execution ?? 'main'),
    worktreeFromOrigin: repository?.kind ? false : (defaults.worktreeFromOrigin ?? false),
  }
}

/** The effective everyday harness, including shared settings, once explicitly configured. */
export function configuredTaskHarness(runtime: RuntimeDefaults | undefined) {
  const configured =
    runtime?.configured ||
    (runtime?.scopedSettings && resolveScopedSettings(runtime).taskDefaults?.harness)
  return configured ? resolveTaskDefaults(runtime, undefined).harness : undefined
}
