import { Schema } from 'effect'
import { mutableStruct } from '../../shared/schema.js'
import { mergeResources } from '../../shared/resources.js'
import {
  scopedSettingsValueSchema,
  settingsScopeSchema,
  sharedSettingsSchema,
  type Repository,
  type ScopedSettingsValue,
  type SharedSettingsEntry,
  type SettingsScope,
} from '../../workspace.js'
import type { RuntimeDefaults } from './runtime-setup.js'

export const scopedSettingsReadSchema = mutableStruct({
  scope: settingsScopeSchema,
  repositoryId: Schema.optional(Schema.String),
})
export const scopedSettingsResultSchema = mutableStruct({
  value: scopedSettingsValueSchema,
  inherited: scopedSettingsValueSchema,
  projectKey: Schema.optional(Schema.String),
})
export const scopedSettingsSaveSchema = mutableStruct({
  ...scopedSettingsReadSchema.fields,
  projectKey: Schema.optional(Schema.String),
  before: scopedSettingsValueSchema,
  after: scopedSettingsValueSchema,
})
export const sharedSettingsSyncSchema = mutableStruct({ shared: sharedSettingsSchema })

export function environmentSettings(runtime: RuntimeDefaults | undefined): ScopedSettingsValue {
  if (runtime?.scopedSettings) return runtime.scopedSettings.environment
  if (!runtime) return {}
  return {
    taskDefaults: {
      harness: runtime.harness,
      permission: runtime.permission,
      execution: runtime.execution,
      setupCommand: runtime.setupCommand,
      worktreeFromOrigin: runtime.worktreeFromOrigin,
    },
  }
}
/** Editing initializes scopes without treating an implicit first-run default as an override. */
export function initializeScopedSettings(runtime: RuntimeDefaults | undefined) {
  return (
    runtime?.scopedSettings ?? {
      environment: runtime?.configured ? environmentSettings(runtime) : {},
      shared: [],
    }
  )
}
export function scopeEditorDefaults(runtime: RuntimeDefaults | undefined) {
  return runtime ? { ...runtime, scopedSettings: initializeScopedSettings(runtime) } : undefined
}
export function scopeEditorValue(
  runtime: RuntimeDefaults | undefined,
  repository: Repository | undefined,
  scope: SettingsScope,
) {
  return settingsAtScope(scopeEditorDefaults(runtime), repository, scope)
}
export function sharedProjectKey(repository: Repository | undefined) {
  return repository?.gitIdentity ? `project:${repository.gitIdentity}` : undefined
}
const newerEntry = (entry: SharedSettingsEntry, current: SharedSettingsEntry | undefined) =>
  !current ||
  entry.updatedAt > current.updatedAt ||
  (entry.updatedAt === current.updatedAt && entry.changeId > current.changeId)

export function pendingSharedSettings(
  shared: readonly SharedSettingsEntry[],
  known: readonly SharedSettingsEntry[],
) {
  const byKey = new Map(known.map((entry) => [entry.key, entry]))
  return shared.filter((entry) => newerEntry(entry, byKey.get(entry.key)))
}
export function mergeSharedSettings(...sources: readonly (readonly SharedSettingsEntry[])[]) {
  const values = new Map<string, SharedSettingsEntry>()
  for (const source of sources)
    for (const entry of source) {
      const current = values.get(entry.key)
      if (newerEntry(entry, current)) values.set(entry.key, entry)
    }
  return [...values.values()].sort((a, b) => a.key.localeCompare(b.key))
}
export function settingsAtScope(
  runtime: RuntimeDefaults | undefined,
  repository: Repository | undefined,
  scope: SettingsScope,
): ScopedSettingsValue {
  if (scope === 'environment') return environmentSettings(runtime)
  if (scope === 'environment-project')
    return {
      taskDefaults: repository?.taskDefaults,
      resources: repository?.resources,
      prompts: repository?.prompts,
    }
  const key = scope === 'global' ? 'global' : sharedProjectKey(repository)
  return runtime?.scopedSettings?.shared.find((entry) => entry.key === key)?.value ?? {}
}
export const settingsScopes: readonly SettingsScope[] = [
  'global',
  'environment',
  'project',
  'environment-project',
]
export const settingsScopeLabels: Record<SettingsScope, string> = {
  global: 'Global',
  environment: 'Environment',
  project: 'Project',
  'environment-project': 'Environment + project',
}
export function resolveScopedSettings(
  runtime: RuntimeDefaults | undefined,
  repository?: Repository,
  before?: SettingsScope,
): ScopedSettingsValue {
  let result: ScopedSettingsValue = {}
  for (const scope of settingsScopes) {
    if (scope === before) break
    const value = settingsAtScope(runtime, repository, scope)
    result = {
      taskDefaults: {
        ...result.taskDefaults,
        ...Object.fromEntries(
          Object.entries(value.taskDefaults ?? {}).filter(([, value]) => value !== undefined),
        ),
      },
      resources: {
        ...mergeResources(result.resources, value.resources),
        hooks: [
          ...new Map(
            [...(result.resources?.hooks ?? []), ...(value.resources?.hooks ?? [])].map((hook) => [
              hook.name,
              hook,
            ]),
          ).values(),
        ],
      },
      prompts: [
        ...new Map(
          [...(result.prompts ?? []), ...(value.prompts ?? [])].map((prompt) => [
            prompt.name.toLowerCase(),
            prompt,
          ]),
        ).values(),
      ],
    }
  }
  return result
}

export function projectPrompts(repository: Repository | undefined, defaults?: RuntimeDefaults) {
  return resolveScopedSettings(defaults, repository).prompts
}

export function resourceScopeChoices(
  runtime: RuntimeDefaults | undefined,
  workspace: {
    repositories: readonly Repository[]
    agents: readonly import('../../workspace.js').Agent[]
  },
) {
  const scoped = (scope: SettingsScope, repository?: Repository) => ({
    id: `settings:${scope}:${repository?.id ?? ''}`,
    item: {
      id: repository?.id ?? scope,
      name: repository?.name ?? settingsScopeLabels[scope],
      resources: scopeEditorValue(runtime, repository, scope).resources,
    },
    label: settingsScopeLabels[scope],
    collection: 'settings' as const,
    scope,
    repository,
  })
  return [
    scoped('global'),
    scoped('environment'),
    ...workspace.repositories.flatMap((repository) => [
      ...(repository.gitIdentity ? [scoped('project', repository)] : []),
      scoped('environment-project', repository),
    ]),
    ...workspace.agents.map((item) => ({
      id: `agent:${item.id}`,
      item,
      label: 'Agent',
      collection: 'agents' as const,
      scope: undefined,
      repository: undefined,
    })),
  ]
}
