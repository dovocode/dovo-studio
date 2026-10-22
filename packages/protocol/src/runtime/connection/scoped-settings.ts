import { Schema } from 'effect'
import { mutableStruct } from '../../shared/schema.js'
import { mergeResources } from '../../shared/resources.js'
import {
  scopedSettingsValueSchema,
  projectDisplayName,
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
      modelSelection: runtime.modelSelection,
      permission: runtime.permission,
      approvalPolicy: runtime.approvalPolicy,
      sandboxMode: runtime.sandboxMode,
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
  return repository?.gitIdentity && !repository.kind && !repository.gitIdentityError
    ? `project:${repository.gitIdentity}`
    : undefined
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
  global: 'All machines & projects',
  environment: 'Machine',
  project: 'Project',
  'environment-project': 'Project on machine',
}

export function settingsScopeSummary(
  scope: SettingsScope,
  context: { project?: string; computer?: string },
) {
  const project = context.project ?? 'Selected project'
  const computer = context.computer ?? 'Selected computer'
  switch (scope) {
    case 'global':
      return {
        title: 'All projects on all machines',
        description:
          'Defaults for all projects on all machines. More-specific overrides keep their own values.',
        storage: 'Shared across paired machines',
      }
    case 'environment':
      return {
        title: `${computer} defaults`,
        description:
          'Defaults for projects on this machine. Project defaults override machine defaults.',
        storage: `Saved on ${computer}`,
      }
    case 'project':
      return {
        title: `${project} project defaults`,
        description:
          'Defaults for this project across machines. Project-on-machine overrides keep their own values.',
        storage: 'Shared across paired machines',
      }
    case 'environment-project':
      return {
        title: `${project} on ${computer}`,
        description:
          'Changes apply only to this project on this machine. This is the most specific level.',
        storage: `Saved on ${computer}`,
      }
  }
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
      if (!projects.has(id)) projects.set(id, { id, name: projectDisplayName(repository) })
    }
  }
  return [...projects.values()].sort((a, b) => a.name.localeCompare(b.name))
}

const taskDefaultFields = [
  { key: 'defaultServerId', label: 'Default server' },
  { key: 'harness', label: 'Agent, model & instructions' },
  { key: 'modelSelection', label: 'Model selection' },
  { key: 'permission', label: 'Permissions' },
  { key: 'approvalPolicy', label: 'Approval policy' },
  { key: 'sandboxMode', label: 'Sandbox' },
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

/** Counts edited fields, treating a missing value and explicit undefined as inheritance. */
export function settingsChangeCount(before: object, after: object): number {
  const previous = new Map<string, unknown>(Object.entries(before))
  const next = new Map<string, unknown>(Object.entries(after))
  return [...new Set([...previous.keys(), ...next.keys()])].filter(
    (key) => JSON.stringify(previous.get(key)) !== JSON.stringify(next.get(key)),
  ).length
}

export type SettingsChange = { key: string; label: string; before: string; after: string }
const changeLabels: Record<string, string> = {
  inactiveDays: 'Days of inactivity before settling',
  archiveAfterSettledDays: 'Days in Settled before archiving',
  autoArchiveSettled: 'Auto-archive settled tasks',
  continueAfterRestart: 'Continue after restarts',
  settleMerged: 'Auto-settle merged tasks',
  settleClosed: 'Auto-settle closed tasks',
  settleInactive: 'Auto-settle inactive tasks',
  quotaResume: 'Auto-resume limited tasks',
  quotaSnooze: 'Snooze limited tasks',
  defaultServerId: 'Default computer',
  modelSelection: 'Model selection',
  agentId: 'Agent',
  setupCommand: 'Setup command',
  prompts: 'Saved prompts',
  approvalPolicy: 'Approval policy',
  sandboxMode: 'Sandbox mode',
  worktreeFromOrigin: 'Create worktrees from remote',
}
function changeValue(value: unknown): string {
  if (value === undefined) return 'Inherit'
  if (value === null) return 'Provider default'
  if (typeof value === 'boolean') return value ? 'On' : 'Off'
  if (value === '') return 'Empty'
  return typeof value === 'string' ? value : JSON.stringify(value)
}
/** A review of the actual edited fields, also used to compare a CAS baseline with remote edits. */
export function settingsChanges(before: object, after: object): SettingsChange[] {
  const previous = new Map<string, unknown>(Object.entries(before))
  const next = new Map<string, unknown>(Object.entries(after))
  return [...new Set([...previous.keys(), ...next.keys()])].flatMap((key) => {
    const a = previous.get(key),
      b = next.get(key)
    if (JSON.stringify(a) === JSON.stringify(b)) return []
    // Scoped settings contain independent groups; review their fields separately.
    if (['taskDefaults', 'taskBehavior', 'commands'].includes(key)) {
      const object = (value: unknown): object =>
        value !== null && typeof value === 'object' ? value : {}
      return settingsChanges(object(a), object(b)).map((entry) => ({
        ...entry,
        key: `${key}.${entry.key}`,
      }))
    }
    const words = key.replace(/([a-z])([A-Z])/g, '$1 $2')
    return [
      {
        key,
        label: changeLabels[key] ?? words.charAt(0).toUpperCase() + words.slice(1),
        before: changeValue(a),
        after: changeValue(b),
      },
    ]
  })
}

/** Empty inherits; invalid text remains in the editor until corrected or discarded. */
export function validSettingsDays(value: string) {
  return value === '' || (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 365)
}
