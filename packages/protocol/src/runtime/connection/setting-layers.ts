import {
  settingsAtScope,
  settingsScopes,
  scopeEditorDefaults,
  settingsProjectId,
  type SettingsTarget,
} from './scoped-settings.js'
import { defaultWorktreeFromOrigin, type RuntimeDefaults } from './runtime-setup.js'
import type { Repository, ScopedSettingsValue, SettingsScope } from '../../workspace.js'

export type SettingField =
  | { group: 'taskDefaults'; key: keyof NonNullable<ScopedSettingsValue['taskDefaults']> }
  | { group: 'taskBehavior'; key: keyof NonNullable<ScopedSettingsValue['taskBehavior']> }

export type SettingSourceSetting = {
  field: SettingField
  repository?: Repository
  scope: SettingsScope
  value: unknown
  /** Resolved by the settings read endpoint, including the control's fallback where needed. */
  inheritedValue: unknown
}

export function settingSourceName(
  source: SettingsScope | 'built-in' | 'computer-default',
  context: { project?: string; computer?: string } = {},
) {
  const computer = context.computer ?? 'This computer'
  const project = context.project ?? 'This project'
  switch (source) {
    case 'built-in':
      return 'Dovo defaults'
    case 'computer-default':
      return `${computer} preferences`
    case 'global':
      return 'All projects on all machines'
    case 'environment':
      return `${computer} defaults`
    case 'project':
      return `${project} project defaults`
    case 'environment-project':
      return `${project} on ${computer}`
  }
}

/** Describe the value at the edited level, never a more-specific override on another target. */
export function settingValueDescription(
  field: SettingField,
  value: unknown,
  computers: readonly { id: string; name: string }[] = [],
): string {
  if (value === null) return 'Provider default'
  if (field.group === 'taskBehavior') {
    if (field.key === 'inactiveDays') return `${settingValueLabel(value ?? 3)} days`
    if (field.key === 'archiveAfterSettledDays') return `${settingValueLabel(value ?? 7)} days`
    if (field.key === 'autoArchiveSettled' && value === undefined)
      return 'Computer inactivity policy'
    return value === undefined ? 'Off' : settingValueLabel(value)
  }
  if (value === undefined) {
    switch (field.key) {
      case 'defaultServerId':
        return 'Automatic · current computer'
      case 'harness':
        return 'Codex · provider default model'
      case 'modelSelection':
        return 'Use selected agent'
      case 'permission':
        return 'Full access'
      case 'execution':
        return 'Local checkout'
      case 'submodules':
        return 'None'
      case 'worktreeFromOrigin':
        return defaultWorktreeFromOrigin ? 'On' : 'Off'
      case 'setupCommand':
        return 'No setup command'
      case 'approvalPolicy':
      case 'sandboxMode':
        return 'Provider default'
    }
  }
  if (field.key === 'setupCommand' && value === '') return 'No setup command'
  if (field.key === 'modelSelection') return value === 'smart' ? 'Maestro' : 'Use selected agent'
  if (field.key === 'defaultServerId' && typeof value === 'string' && computers.length)
    return computers.find((entry) => entry.id === value)?.name ?? 'Unavailable computer'
  if (field.key === 'permission' && value === 'full-access') return 'Full access'
  return settingValueLabel(value)
}

/** Keep commands and instructions readable in rows; inheritance details retain the full value. */
export function settingValuePreview(value: string) {
  const line = value.replace(/\s+/g, ' ').trim()
  return line.length > 80 ? `${line.slice(0, 77)}…` : line
}

/** A settings read can be newer than the fleet snapshot used to name its source. */
export function settingInheritanceIsCurrent(
  runtime: RuntimeDefaults | undefined,
  setting: SettingSourceSetting,
  source: SettingsScope | 'built-in' | 'computer-default',
) {
  // Lifecycle preferences are read separately by the editor, outside the scoped snapshot.
  if (source === 'computer-default') return true
  const level = settingsScopes.indexOf(setting.scope)
  const inherited = settingLayers(runtime, setting.repository, setting.field).find(
    (row) => settingsScopes.indexOf(row.scope) < level && row.value !== undefined,
  )
  return (
    settingValueDescription(setting.field, inherited?.value) ===
    settingValueDescription(setting.field, setting.inheritedValue)
  )
}

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
  if (
    field.group === 'taskBehavior' &&
    (field.key === 'continueAfterRestart' ||
      field.key === 'settleMerged' ||
      field.key === 'settleClosed' ||
      field.key === 'autoArchiveSettled')
  )
    return 'Computer lifecycle preference'
  return `${settingValueDescription(field, undefined)} · Dovo default`
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
