import { settingsAtScope, settingsScopes, scopeEditorDefaults } from './scoped-settings.js'
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
