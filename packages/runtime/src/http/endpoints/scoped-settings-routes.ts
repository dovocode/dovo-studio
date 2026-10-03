import { isDeepStrictEqual } from 'node:util'
import { randomUUID } from 'node:crypto'
import { Effect } from 'effect'
import type { IncomingMessage } from 'node:http'
import {
  decode,
  catalogSkillSource,
  scopedSettingsReadSchema,
  scopedSettingsSaveSchema,
  sharedSettingsSyncSchema,
  initializeScopedSettings,
  settingsAtScope,
  resolveScopedSettings,
  sharedProjectKey,
  mergeSharedSettings,
  type SharedSettingsEntry,
  type ScopedSettingsValue,
} from '@dovo/protocol'
import { RuntimeServices } from '../../services.js'
import { HttpError } from '../../errors.js'
import { validateDefaultHarness } from '../../storage/runtime-defaults.js'
import { body } from '../support/body.js'
import { serviceResult } from '../support/effect.js'

function validatePrompts(value: ScopedSettingsValue) {
  const prompts = value.prompts ?? []
  if (
    prompts.some((prompt) => !/^[\w.-]+$/.test(prompt.name) || !prompt.text.trim()) ||
    new Set(prompts.map((prompt) => prompt.name.toLowerCase())).size !== prompts.length
  )
    throw new HttpError(
      400,
      'Prompts require nonempty text and unique names using letters, numbers, dots, dashes or underscores.',
    )
}
function prepareShared(value: ScopedSettingsValue): ScopedSettingsValue {
  if (!value.resources) return value
  return {
    ...value,
    resources: {
      ...value.resources,
      skills: value.resources.skills.map((skill) => {
        if (!skill.sourcePath) return skill
        if (!catalogSkillSource(skill))
          throw new HttpError(
            400,
            'Local skill supporting files belong to this environment. Use instructions only for shared skills, or keep the skill in an environment-specific scope.',
          )
        return { ...skill, sourcePath: undefined }
      }),
    },
  }
}
function validateShared(value: ScopedSettingsValue) {
  validatePrompts(value)
  if (value.resources?.skills.some((skill) => skill.sourcePath))
    throw new HttpError(400, 'Shared skills cannot contain environment-specific file paths.')
  if (
    value.resources?.mcpServers.some(
      (server) =>
        Object.keys(server.envValues ?? {}).length || Object.keys(server.headerValues ?? {}).length,
    )
  )
    throw new HttpError(
      400,
      'Shared MCP settings must reference environment variables. Keep literal credentials in environment-specific overrides.',
    )
  if (value.taskDefaults?.harness?.acpInstallationId)
    throw new HttpError(
      400,
      'Installed ACP agents belong to one environment. Select them in an environment-specific scope.',
    )
}
function validateKey(entry: SharedSettingsEntry) {
  if (entry.key !== 'global' && !/^project:[^/\s]+\/[^\r\n]+$/.test(entry.key))
    throw new HttpError(400, 'Invalid shared project identity')
  validateShared(entry.value)
}
export function scopedSettingsRoute(request: IncomingMessage, path: string) {
  return Effect.gen(function* () {
    const s = yield* RuntimeServices
    const raw = yield* serviceResult(body(request))
    let current = s.defaults.get()
    let scoped = initializeScopedSettings(current)
    if (path === '/api/agents/settings/sync') {
      const { shared } = decode(sharedSettingsSyncSchema, raw)
      for (const entry of shared) validateKey(entry)
      const merged = mergeSharedSettings(scoped.shared, shared)
      if (!isDeepStrictEqual(merged, scoped.shared))
        s.defaults.save({ ...current, scopedSettings: { ...scoped, shared: merged } }, false)
      return { shared: merged }
    }
    const input = decode(
      path.endsWith('/save') ? scopedSettingsSaveSchema : scopedSettingsReadSchema,
      raw,
    )
    let repository = s.store.get().repositories.find((repo) => repo.id === input.repositoryId)
    if (input.scope === 'project' || input.scope === 'environment-project') {
      if (!repository) throw new HttpError(404, 'Choose a project')
      const gitIdentity = repository.kind
        ? undefined
        : input.scope === 'project'
          ? yield* serviceResult(s.git.repositoryIdentity(repository.path, true)).pipe(
              Effect.mapError(
                () =>
                  new HttpError(
                    400,
                    'Cannot inspect this project’s Git remote. Use environment + project for local overrides.',
                  ),
              ),
            )
          : repository.gitIdentity
      if (repository.gitIdentity !== gitIdentity) {
        s.store.update((workspace) => ({
          ...workspace,
          repositories: workspace.repositories.map((repo) =>
            repo.id === repository?.id ? { ...repo, gitIdentity } : repo,
          ),
        }))
        repository = { ...repository, gitIdentity }
      }
      if (input.scope === 'project' && !gitIdentity)
        throw new HttpError(
          400,
          'Shared project settings require an unambiguous Git remote. Use environment + project for local folders.',
        )
    }
    // Git inspection can yield while another request saves. Compare against the latest document.
    current = s.defaults.get()
    scoped = initializeScopedSettings(current)
    if (repository)
      repository = s.store.get().repositories.find((repo) => repo.id === repository?.id)
    const base = { ...current, scopedSettings: scoped }
    const value = settingsAtScope(base, repository, input.scope)
    if (path.endsWith('/save')) {
      const save = decode(scopedSettingsSaveSchema, raw)
      if (input.scope === 'project' && save.projectKey !== sharedProjectKey(repository))
        throw new HttpError(409, 'The project remote changed. Reload settings before saving.')
      if (!isDeepStrictEqual(JSON.parse(JSON.stringify(s.store.publicValue(value))), save.before))
        throw new HttpError(409, 'Settings changed on another device. Reload before saving.')
      let after = decode(scopedSettingsSaveSchema.fields.after, s.store.restoreSecrets(save.after))
      validatePrompts(after)
      if (input.scope === 'global' || input.scope === 'project') {
        after = prepareShared(after)
        validateShared(after)
      }
      if (after.taskDefaults?.harness) {
        validateDefaultHarness(after.taskDefaults.harness)
        if (after.taskDefaults.harness.acpInstallationId)
          s.agents.launch(after.taskDefaults.harness)
      }
      if (input.scope === 'environment-project') {
        if (!repository) throw new HttpError(404, 'Choose a project')
        const id = repository.id
        s.store.update((workspace) => ({
          ...workspace,
          repositories: workspace.repositories.map((repo) =>
            repo.id === id
              ? {
                  ...repo,
                  taskDefaults: after.taskDefaults,
                  resources: after.resources,
                  prompts: after.prompts,
                }
              : repo,
          ),
        }))
        repository = {
          ...repository,
          taskDefaults: after.taskDefaults,
          resources: after.resources,
          prompts: after.prompts,
        }
      } else if (input.scope === 'environment') {
        scoped.environment = after
        s.defaults.save({ ...current, scopedSettings: scoped }, false)
      } else {
        validateShared(after)
        const key = input.scope === 'global' ? 'global' : sharedProjectKey(repository)
        if (!key) throw new HttpError(400, 'The project has no shared identity')
        const updatedAt = Math.max(Date.now(), ...scoped.shared.map((entry) => entry.updatedAt + 1))
        scoped.shared = mergeSharedSettings(scoped.shared, [
          { key, updatedAt, changeId: randomUUID(), value: after },
        ])
        s.defaults.save({ ...current, scopedSettings: scoped }, false)
      }
      return s.store.publicValue({
        value: after,
        inherited: resolveScopedSettings(base, repository, input.scope),
        projectKey: sharedProjectKey(repository),
      })
    }
    return s.store.publicValue({
      value,
      inherited: resolveScopedSettings(base, repository, input.scope),
      projectKey: sharedProjectKey(repository),
    })
  })
}
