import type { Repository } from '../../workspace.js'
import type { RuntimeDefaults } from './runtime-setup.js'
import {
  sharedProjectKey,
  settingsAtScope,
  initializeScopedSettings,
  mergeSharedSettings,
} from './scoped-settings.js'

/** Shared resets deliberately suppress old per-computer custom images. */
export function sharedProjectIcon(runtime: RuntimeDefaults, repository: Repository) {
  const value = settingsAtScope(runtime, repository, 'project').projectIcon
  return value === undefined ? repository.iconOverride : (value ?? undefined)
}

export function sharedProjectIconEntry(
  runtime: RuntimeDefaults,
  repository: Repository,
  icon: string | undefined,
  revision: { updatedAt: number; changeId: string },
) {
  const key = sharedProjectKey(repository)
  if (!key) return undefined
  return {
    key,
    ...revision,
    value: { ...settingsAtScope(runtime, repository, 'project'), projectIcon: icon ?? null },
  }
}

/** Promote existing custom images once; shared reset tombstones prevent resurrection. */
export function migrateProjectIcons(
  runtime: RuntimeDefaults,
  repositories: readonly Repository[],
  revision: { updatedAt: number; changeId: string },
) {
  const scoped = initializeScopedSettings(runtime)
  let shared = scoped.shared
  for (const repository of [...repositories].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!repository.iconOverride || !repository.gitIdentity || repository.kind) continue
    const current = { ...runtime, scopedSettings: { ...scoped, shared } }
    if (settingsAtScope(current, repository, 'project').projectIcon !== undefined) continue
    const entry = sharedProjectIconEntry(current, repository, repository.iconOverride, {
      ...revision,
      updatedAt: Math.max(revision.updatedAt, ...shared.map((entry) => entry.updatedAt + 1)),
    })
    if (entry) shared = mergeSharedSettings(shared, [entry])
  }
  return shared === scoped.shared
    ? undefined
    : { ...runtime, scopedSettings: { ...scoped, shared } }
}
