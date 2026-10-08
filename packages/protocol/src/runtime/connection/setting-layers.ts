import {
  settingsAtScope,
  settingsScopes,
  scopeEditorDefaults,
  settingsProjectId,
  type SettingsTarget,
} from './scoped-settings.js'
import type { RuntimeDefaults } from './runtime-setup.js'
import type { Repository, ScopedSettingsValue, SettingsScope } from '../../workspace.js'

export type SettingField =
  | { group: 'taskDefaults'; key: keyof NonNullable<ScopedSettingsValue['taskDefaults']> }
  | { group: 'taskBehavior'; key: keyof NonNullable<ScopedSettingsValue['taskBehavior']> }

/** Keep explicit false/empty overrides; never infer inheritance from truthiness. */
export function settingLayers(
  runtime: RuntimeDefaults | undefined,
  repository: Repository | undefined,
  field: SettingField,
  edit?: { scope: SettingsScope; value: unknown },
) {
  const rows = settingsScopes
    .filter((scope) => repository || (scope !== 'project' && scope !== 'environment-project'))
    .map((scope) => {
      const settings = settingsAtScope(scopeEditorDefaults(runtime), repository, scope)
      const stored =
        field.group === 'taskDefaults'
          ? settings.taskDefaults?.[field.key]
          : settings.taskBehavior?.[field.key]
      const value = edit?.scope === scope ? edit.value : stored
      return { scope, value, effective: false }
    })
  const winner = [...rows].reverse().find((row) => row.value !== undefined)
  if (winner) winner.effective = true
  return rows.reverse()
}

export function settingValueLabel(value: unknown): string {
  if (value === undefined) return 'Inherit'
  if (value === true) return 'On'
  if (value === false) return 'Off'
  if (value === '') return 'Disabled'
  if (value === 'main') return 'Local checkout'
  if (value === 'worktree') return 'New worktree'
  if (typeof value === 'object' && value !== null && 'provider' in value)
    return [value.provider, 'model' in value ? value.model : undefined].filter(Boolean).join(' · ')
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  return JSON.stringify(value) ?? 'Unavailable'
}

export function settingBaseLabel(field: SettingField) {
  if (field.group === 'taskBehavior') {
    if (field.key === 'inactiveDays') return '3 days · Dovo default'
    if (
      field.key === 'continueAfterRestart' ||
      field.key === 'settleMerged' ||
      field.key === 'settleClosed'
    )
      return 'Computer lifecycle preference'
    return 'Off · Dovo default'
  }
  switch (field.key) {
    case 'defaultServerId':
      return 'Automatic · prefer current server'
    case 'harness':
      return 'Codex · provider default model · Dovo default'
    case 'permission':
      return 'Full access · Dovo default'
    case 'execution':
      return 'Local checkout · Dovo default'
    case 'submodules':
      return 'None · Dovo default'
    case 'worktreeFromOrigin':
      return 'Off · Dovo default'
    case 'setupCommand':
      return 'No setup command · Dovo default'
  }
}

export type SettingOverrideSource = {
  profile: { id: string }
  name: string
  snapshot: {
    defaults?: RuntimeDefaults
    workspace: { repositories: readonly Repository[] }
  } | null
}
export type SettingOverride = {
  scope: SettingsScope
  /** Selecting this target edits the override. */
  target: SettingsTarget
  /** The computer that stores the override, also for shared project entries. */
  environmentId: string
  repositoryId?: string
  computer?: string
  project?: string
  value: unknown
}
function storedValue(
  runtime: RuntimeDefaults | undefined,
  repository: Repository | undefined,
  scope: SettingsScope,
  field: SettingField,
) {
  const settings = settingsAtScope(scopeEditorDefaults(runtime), repository, scope)
  return field.group === 'taskDefaults'
    ? settings.taskDefaults?.[field.key]
    : settings.taskBehavior?.[field.key]
}
/** Later levels that keep their own value while the selected level changes. A computer lists only
 * its own projects; a shared project lists each computer's local override. Shared project
 * overrides appear once even when several computers have the checkout. */
export function settingOverrides(
  sources: readonly SettingOverrideSource[],
  field: SettingField,
  editing: { scope: SettingsScope; repository?: Repository; environmentId?: string },
): SettingOverride[] {
  const later = settingsScopes.slice(settingsScopes.indexOf(editing.scope) + 1)
  const result: SettingOverride[] = []
  const sharedProjects = new Set<string>()
  for (const source of sources) {
    const snapshot = source.snapshot
    if (!snapshot || (editing.environmentId && editing.environmentId !== source.profile.id))
      continue
    const id = source.profile.id
    const repositories = snapshot.workspace.repositories.filter(
      (repository) =>
        !editing.repository ||
        (!!repository.gitIdentity && repository.gitIdentity === editing.repository.gitIdentity),
    )
    for (const scope of later) {
      if (scope === 'environment') {
        const value = storedValue(snapshot.defaults, undefined, scope, field)
        if (value !== undefined)
          result.push({
            scope,
            target: { environmentId: id, projectId: '' },
            environmentId: id,
            computer: source.name,
            value,
          })
        continue
      }
      for (const repository of repositories) {
        const identity = repository.gitIdentity
        if (scope === 'project' && (!identity || sharedProjects.has(identity))) continue
        const value = storedValue(snapshot.defaults, repository, scope, field)
        if (value === undefined) continue
        if (scope === 'project' && identity) sharedProjects.add(identity)
        result.push({
          scope,
          target: {
            environmentId: scope === 'project' ? '' : id,
            projectId: settingsProjectId(repository, id),
          },
          environmentId: id,
          repositoryId: repository.id,
          computer: scope === 'project' ? undefined : source.name,
          project: repository.name,
          value,
        })
      }
    }
  }
  return result.sort(
    (a, b) =>
      settingsScopes.indexOf(a.scope) - settingsScopes.indexOf(b.scope) ||
      (a.project ?? '').localeCompare(b.project ?? '') ||
      (a.computer ?? '').localeCompare(b.computer ?? ''),
  )
}
