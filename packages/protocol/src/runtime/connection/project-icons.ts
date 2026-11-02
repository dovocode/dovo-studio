import type { Repository, ScopedSettingsValue } from '../../workspace.js'
import type { RuntimeDefaults } from './runtime-setup.js'
import {
  sharedProjectKey,
  settingsAtScope,
  initializeScopedSettings,
  mergeSharedSettings,
  updateSharedSettingsEntry,
} from './scoped-settings.js'

/** Shared resets deliberately suppress old per-computer custom images. */
export function sharedProjectIcon(runtime: RuntimeDefaults, repository: Repository) {
  const value = settingsAtScope(runtime, repository, 'project').projectIcon
  return value === undefined ? repository.iconOverride : (value ?? undefined)
}

/** Runtime-side edit of shared project categories; only changed categories get a revision. */
export function sharedProjectEntry(
  runtime: RuntimeDefaults,
  repository: Repository,
  change: ScopedSettingsValue,
  revision: { updatedAt: number; changeId: string },
) {
  const key = sharedProjectKey(repository)
  if (!key) return undefined
  return updateSharedSettingsEntry(
    key,
    runtime.scopedSettings?.shared.find((entry) => entry.key === key),
    { ...settingsAtScope(runtime, repository, 'project'), ...change },
    revision,
  )
}
export function sharedProjectIconEntry(
  runtime: RuntimeDefaults,
  repository: Repository,
  icon: string | undefined,
  revision: { updatedAt: number; changeId: string },
) {
  return sharedProjectEntry(runtime, repository, { projectIcon: icon ?? null }, revision)
}

/** Presentation may use last-confirmed identity without granting reads or executable settings. */
export function sharedProjectPresentation(
  runtime: RuntimeDefaults,
  repository: Repository,
): Repository {
  const identity = repository.gitIdentity ?? repository.presentationIdentity
  const value =
    !repository.kind && identity
      ? runtime.scopedSettings?.shared.find((entry) => entry.key === `project:${identity}`)?.value
      : undefined
  return {
    ...repository,
    localName: repository.localName ?? repository.name,
    sharedName: value?.projectName ?? undefined,
    name: value?.projectName ?? repository.localName ?? repository.name,
    iconOverride:
      value?.projectIcon === undefined ? repository.iconOverride : (value.projectIcon ?? undefined),
    pinned: value?.projectPinned ?? repository.pinned,
    archived: value?.projectArchived ?? repository.archived,
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
