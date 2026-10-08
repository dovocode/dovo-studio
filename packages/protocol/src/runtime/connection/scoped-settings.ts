import { Schema } from 'effect'
import { mutableStruct } from '../../shared/schema.js'
import { mergeResources } from '../../shared/resources.js'
import {
  scopedSettingsValueSchema,
  settingsScopeSchema,
  sharedSettingsSchema,
  type Agent,
  type Repository,
  type ScopedSettingsValue,
  type SharedSettingsEntry,
  type SettingsScope,
} from '../../workspace.js'
import type { RuntimeDefaults } from './runtime-setup.js'
import { builtInAgentPresets } from '../../tasks/agent-presets.js'

export const scopedSettingsReadSchema = mutableStruct({
  includeAgents: Schema.optional(Schema.Boolean),
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
      taskBehavior: repository?.taskBehavior,
      resources: repository?.resources,
      prompts: repository?.prompts,
      agents: repository?.agents,
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
  environment: 'Computer',
  project: 'Project',
  'environment-project': 'Project on computer',
}
export const settingsScopeDescriptions: Record<SettingsScope, string> = {
  global: 'All projects on all computers',
  environment: 'All projects on one computer',
  project: 'One project across computers',
  'environment-project': 'One project on one computer',
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
      ...(value.agents || result.agents
        ? {
            agents: [
              ...new Map(
                [...(result.agents ?? []), ...(value.agents ?? [])].map((agent) => [
                  agent.id,
                  agent,
                ]),
              ).values(),
            ],
          }
        : {}),
      taskBehavior: {
        ...result.taskBehavior,
        ...Object.fromEntries(
          Object.entries(value.taskBehavior ?? {}).filter(([, value]) => value !== undefined),
        ),
      },
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
    namedAgentId: undefined,
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
    ...settingsScopes.flatMap((scope) => {
      const repositories =
        scope === 'project' || scope === 'environment-project'
          ? workspace.repositories
          : [undefined]
      return repositories.flatMap((repository) =>
        (settingsAtScope(runtime, repository, scope).agents ?? []).map((item) => ({
          id: `settings-agent:${scope}:${repository?.id ?? ''}:${item.id}`,
          item,
          label: `${settingsScopeLabels[scope]} agent`,
          collection: 'settings' as const,
          namedAgentId: item.id,
          scope,
          repository,
        })),
      )
    }),
    ...(environmentSettings(runtime).agents === undefined ? workspace.agents : []).map((item) => ({
      id: `agent:${item.id}`,
      item,
      label: 'Agent',
      collection: 'agents' as const,
      namedAgentId: undefined,
      scope: undefined,
      repository: undefined,
    })),
  ]
}

/** The two independent settings axes select one inheritance layer, never a bulk edit. */
export type SettingsTarget = { environmentId: string; projectId: string }
export type SettingsTargetSource = {
  profile: { id: string }
  connected: boolean
  snapshot: { workspace: { repositories: readonly Repository[] } } | null
}
export function settingsProjectId(repository: Repository, environmentId: string) {
  return repository.gitIdentity
    ? `git:${repository.gitIdentity}`
    : `local:${JSON.stringify([environmentId, repository.id])}`
}
export function resolveSettingsTarget<T extends SettingsTargetSource>(
  sources: readonly T[],
  target: SettingsTarget,
  activeId?: string | null,
) {
  const scope: SettingsScope = target.projectId
    ? target.environmentId
      ? 'environment-project'
      : 'project'
    : target.environmentId
      ? 'environment'
      : 'global'
  const matching = sources.filter(
    (source) =>
      (!target.environmentId || source.profile.id === target.environmentId) &&
      (!target.projectId ||
        source.snapshot?.workspace.repositories.some(
          (repository) =>
            settingsProjectId(repository, source.profile.id) === target.projectId &&
            (scope !== 'project' || !!repository.gitIdentity),
        )),
  )
  const source = target.environmentId
    ? matching[0]
    : (matching.find((source) => source.connected && source.profile.id === activeId) ??
      matching.find((source) => source.connected) ??
      matching[0])
  const repository = source?.snapshot?.workspace.repositories.find(
    (repository) => settingsProjectId(repository, source.profile.id) === target.projectId,
  )
  return { source, repository, scope }
}
export function settingsProjectChoices(
  sources: readonly SettingsTargetSource[],
  environmentId: string,
) {
  const projects = new Map<string, { id: string; name: string }>()
  for (const source of sources) {
    if (environmentId && source.profile.id !== environmentId) continue
    for (const repository of source.snapshot?.workspace.repositories ?? []) {
      if (!environmentId && !repository.gitIdentity) continue
      const id = settingsProjectId(repository, source.profile.id)
      if (!projects.has(id)) projects.set(id, { id, name: repository.name })
    }
  }
  return [...projects.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Explicitly move to a level, preserving the current project/computer when they fit. */
export function settingsTargetAtScope<T extends SettingsTargetSource>(
  sources: readonly T[],
  target: SettingsTarget,
  scope: SettingsScope,
  activeId?: string | null,
): SettingsTarget | undefined {
  if (scope === 'global') return { environmentId: '', projectId: '' }
  const source =
    sources.find((entry) => entry.profile.id === target.environmentId) ??
    sources.find((entry) => entry.profile.id === activeId) ??
    sources[0]
  if (scope === 'environment')
    return source ? { environmentId: source.profile.id, projectId: '' } : undefined
  if (scope === 'project') {
    const projects = settingsProjectChoices(sources, '')
    const project = projects.find((entry) => entry.id === target.projectId) ?? projects[0]
    return project ? { environmentId: '', projectId: project.id } : undefined
  }
  const candidates = [source, ...sources.filter((entry) => entry !== source)].filter(
    (entry): entry is T => !!entry,
  )
  const matching = candidates.find((entry) =>
    settingsProjectChoices([entry], entry.profile.id).some(
      (project) => project.id === target.projectId,
    ),
  )
  const computer =
    matching ?? candidates.find((entry) => settingsProjectChoices([entry], entry.profile.id).length)
  if (!computer) return undefined
  const projects = settingsProjectChoices([computer], computer.profile.id)
  return {
    environmentId: computer.profile.id,
    projectId: projects.find((entry) => entry.id === target.projectId)?.id ?? projects[0].id,
  }
}

const taskDefaultFields = [
  { key: 'defaultServerId', label: 'Default server' },
  { key: 'harness', label: 'Agent, model & instructions' },
  { key: 'permission', label: 'Permissions' },
  { key: 'execution', label: 'Working directory' },
  { key: 'submodules', label: 'Submodules' },
  { key: 'worktreeFromOrigin', label: 'Start from origin' },
  { key: 'setupCommand', label: 'Worktree setup' },
] as const
export function taskDefaultOrigins(
  runtime: RuntimeDefaults | undefined,
  repository: Repository | undefined,
  scope: SettingsScope,
  draft: NonNullable<ScopedSettingsValue['taskDefaults']>,
) {
  return taskDefaultFields.map((field) => {
    let source: SettingsScope | 'built-in' = 'built-in'
    for (const level of settingsScopes) {
      if (level === scope) {
        if (draft[field.key] !== undefined) source = level
        break
      }
      if (
        settingsAtScope(scopeEditorDefaults(runtime), repository, level).taskDefaults?.[
          field.key
        ] !== undefined
      )
        source = level
    }
    return { ...field, source, overridden: draft[field.key] !== undefined }
  })
}

export function taskBehaviorOrigin(
  runtime: RuntimeDefaults | undefined,
  repository: Repository | undefined,
  scope: SettingsScope,
  draft: NonNullable<ScopedSettingsValue['taskBehavior']>,
  key: keyof NonNullable<ScopedSettingsValue['taskBehavior']>,
  computerFallback = false,
) {
  let source: SettingsScope | 'built-in' | 'computer-default' = computerFallback
    ? 'computer-default'
    : 'built-in'
  for (const level of settingsScopes) {
    if (level === scope) {
      if (draft[key] !== undefined) source = level
      break
    }
    if (
      settingsAtScope(scopeEditorDefaults(runtime), repository, level).taskBehavior?.[key] !==
      undefined
    )
      source = level
  }
  return { source, overridden: draft[key] !== undefined }
}

export function resourceOrigin(
  runtime: RuntimeDefaults | undefined,
  repository: Repository | undefined,
  before: SettingsScope,
  kind: 'mcpServers' | 'skills' | 'hooks',
  name: string,
) {
  let source: SettingsScope | 'built-in' = 'built-in'
  for (const level of settingsScopes) {
    if (level === before) break
    if (
      settingsAtScope(scopeEditorDefaults(runtime), repository, level).resources?.[kind]?.some(
        (entry) => entry.name === name,
      )
    )
      source = level
  }
  return source
}

/** Legacy environment configurations retain their identity; more specific scopes override by ID. */
export function scopedAgentEntries(
  runtime: RuntimeDefaults | undefined,
  repository: Repository | undefined,
  legacy: readonly Agent[],
  before?: SettingsScope,
) {
  const result = new Map<string, { agent: Agent; scope: SettingsScope | 'built-in' }>(
    builtInAgentPresets().map((agent) => [agent.id, { agent, scope: 'built-in' }]),
  )
  for (const scope of settingsScopes) {
    if (scope === before) break
    const fallback =
      scope === 'global' && settingsAtScope(runtime, repository, scope).agents === undefined
        ? legacy
            .filter((agent) => agent.globalPreset)
            .flatMap((agent) => (agent.globalPreset ? [agent.globalPreset] : []))
        : scope === 'environment' &&
            settingsAtScope(runtime, repository, scope).agents === undefined
          ? legacy.filter((agent) => !agent.globalPreset || agent.serverOverride)
          : []
    for (const agent of [
      ...fallback,
      ...(settingsAtScope(runtime, repository, scope).agents ?? []),
    ])
      result.set(agent.id, { agent, scope })
  }
  return [...result.values()].sort(
    (a, b) => Number(a.scope === 'built-in') - Number(b.scope === 'built-in'),
  )
}
export function resolveScopedAgents(
  runtime: RuntimeDefaults | undefined,
  repository: Repository | undefined,
  legacy: readonly Agent[],
) {
  return scopedAgentEntries(runtime, repository, legacy).map((entry) => entry.agent)
}
