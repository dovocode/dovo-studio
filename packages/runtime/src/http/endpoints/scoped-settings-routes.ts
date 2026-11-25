import {
  validatePrompts,
  prepareShared,
  validateShared,
  validateSharedEntry,
} from '../../storage/shared-settings-validation.js'
import { isDeepStrictEqual } from 'node:util'
import { randomUUID } from 'node:crypto'
import { Effect, Struct } from 'effect'
import type { IncomingMessage } from 'node:http'
import {
  decode,
  scopedSettingsReadSchema,
  scopedSettingsSaveSchema,
  scopedSettingsValueSchema,
  sharedSettingsSyncSchema,
  initializeScopedSettings,
  organizationChangeSchema,
  organizationKey,
  projectOrganizationId,
  studioOrganizations,
  settingsAtScope,
  resolveScopedSettings,
  scopedAgentEntries,
  decodeResult,
  taskHarnessSchema,
  agentPresetSchema,
  sharedProjectKey,
  resourceSettingsSchema,
  mergeSharedSettings,
  updateSharedSettingsEntry,
  canonicalSharedSettings,
  emptySharedOrganizations,
  organizationGitIdentity,
  type ScopedSettingsValue,
  type SharedOrganizations,
} from '@dovo/protocol'
import { RuntimeServices } from '../../runtime-services.js'
import { HttpError } from '../../errors.js'
import { validateDefaultHarness } from '../../storage/runtime-defaults.js'
import { body } from '../support/body.js'
import { serviceResult } from '../support/effect.js'
import type { Services } from '../../services.js'

function organizationRevision(shared?: SharedOrganizations) {
  const rows = shared ? [...shared.names, ...shared.resources, ...shared.projects] : []
  return {
    updatedAt: rows.reduce((at, row) => Math.max(at, row.updatedAt + 1), Date.now()),
    changeId: randomUUID(),
  }
}

async function changeOrganization(s: Services, raw: unknown) {
  const input = decode(organizationChangeSchema, raw)
  const checkout =
    input.action === 'assign'
      ? s.store.get().repositories.find((entry) => entry.id === input.repositoryId)
      : undefined
  const identity =
    checkout && !checkout.kind ? await s.git.repositoryIdentity(checkout.path, true) : undefined
  return s.store.transaction(() => {
    const { repositories } = s.store.get()
    const defaults = s.defaults.get()
    const shared = defaults.sharedOrganizations
    const revision = organizationRevision(shared)
    const organizations = studioOrganizations(defaults, repositories)
    const idForName = (name: string) => {
      const matching = [...organizations].filter(
        ([, entry]) => organizationKey(entry.name) === organizationKey(name),
      )
      if (matching.length > 1)
        throw new HttpError(
          409,
          'More than one organization uses this name. Rename one before linking a project.',
        )
      return matching[0]?.[0]
    }
    if (input.action === 'rename') {
      const entry = organizations.get(input.organizationId)
      if (!entry) throw new HttpError(404, 'Choose an organization.')
      if (entry.name === input.name) return { ok: true as const }
      if (entry.name !== input.before)
        throw new HttpError(409, 'The organization name changed. Reload before saving.')
      const matchingId = idForName(input.name)
      if (matchingId && matchingId !== input.organizationId)
        throw new HttpError(409, 'An organization already uses this name.')
      if (shared?.names.some((row) => row.id === input.organizationId)) {
        s.defaults.mergeOrganizations({
          ...emptySharedOrganizations(),
          names: [{ id: input.organizationId, name: input.name, ...revision }],
        })
        return { ok: true as const }
      }
      s.defaults.saveOrganizations({
        ...defaults.organizations,
        [input.organizationId]: { ...entry, name: input.name },
      })
      return { ok: true as const }
    }

    const repository = repositories.find((entry) => entry.id === input.repositoryId)
    if (!repository || repository.kind === 'scratch') throw new HttpError(404, 'Choose a project.')
    if (!checkout || repository.path !== checkout.path || repository.kind !== checkout.kind)
      throw new HttpError(409, 'The project checkout changed. Reload before saving.')
    const confirmed = { ...repository, gitIdentity: identity, gitIdentityError: undefined }
    const proposedName = input.target && 'name' in input.target ? input.target.name : undefined
    const requestedId = input.target && 'id' in input.target ? input.target.id : undefined
    if (requestedId && !organizations.has(requestedId))
      throw new HttpError(404, 'Choose an organization.')
    const currentId = projectOrganizationId(confirmed, defaults)
    const targetId = requestedId ?? (proposedName ? idForName(proposedName) : undefined)
    if (currentId === targetId && (targetId || input.target === null)) return { ok: true as const }
    if ((currentId ?? null) !== input.before)
      throw new HttpError(409, 'The project organization changed. Reload before saving.')
    const created =
      proposedName && !targetId ? { id: randomUUID(), name: proposedName, ...revision } : undefined
    const organizationId = targetId ?? created?.id
    const sharedCreation = input.shared ? created : undefined
    const portable = !!sharedCreation || !!shared?.names.some((row) => row.id === organizationId)
    const project = organizationGitIdentity(confirmed)
    const hasSharedLink =
      project && shared?.projects.find((row) => row.id === project)?.organizationId
    if (!input.shared && (portable || hasSharedLink))
      throw new HttpError(409, 'Update this app to change shared organization links.')
    if (hasSharedLink && organizationId && !portable)
      throw new HttpError(
        409,
        'Clear the shared link before choosing a computer-only organization.',
      )
    const sharedLink = project && (portable || hasSharedLink)
    if (sharedCreation || sharedLink)
      s.defaults.mergeOrganizations({
        ...emptySharedOrganizations(),
        names: sharedCreation ? [sharedCreation] : [],
        projects: sharedLink
          ? [{ id: project, organizationId: organizationId ?? null, ...revision }]
          : [],
      })
    if (
      !portable &&
      organizationId &&
      !Object.hasOwn(defaults.organizations ?? {}, organizationId)
    ) {
      const local = created ? { name: created.name } : organizations.get(organizationId)
      if (local)
        s.defaults.saveOrganizations({ ...defaults.organizations, [organizationId]: local })
    }
    s.store.update((workspace) => ({
      ...workspace,
      repositories: workspace.repositories.map((entry) =>
        entry.id === repository.id
          ? {
              ...confirmed,
              organizationId: sharedLink ? undefined : organizationId,
              organization: undefined,
            }
          : entry,
      ),
    }))
    return { ok: true as const }
  })
}

export function scopedSettingsRoute(request: IncomingMessage, path: string) {
  return Effect.gen(function* () {
    const s = yield* RuntimeServices
    const raw = yield* serviceResult(body(request))
    if (path === '/api/agents/settings/organization') return changeOrganization(s, raw)
    let current = s.defaults.get()
    let scoped = initializeScopedSettings(current)
    const canonicalize = (identity: string) => s.git.canonicalRepositoryIdentity(identity)
    const canonical = canonicalSharedSettings(scoped.shared, canonicalize)
    if (canonical !== scoped.shared) {
      scoped = { ...scoped, shared: canonical }
      current = s.defaults.save({ ...current, scopedSettings: scoped }, false)
    }
    if (path === '/api/agents/settings/sync') {
      const { shared } = decode(sharedSettingsSyncSchema, raw)
      for (const entry of shared) validateSharedEntry(entry)
      return { shared: s.defaults.mergeShared(canonicalSharedSettings(shared, canonicalize)) }
    }
    const input = decode(
      path.endsWith('/save') ? scopedSettingsSaveSchema : scopedSettingsReadSchema,
      raw,
    )
    let repository = s.store.get().repositories.find((repo) => repo.id === input.repositoryId)
    if (input.scope === 'organization') {
      const id = input.organizationId
      if (!id) throw new HttpError(400, 'Choose an organization.')
      const defaults = s.defaults.get()
      const organizations = studioOrganizations(defaults, s.store.get().repositories)
      const organization = organizations.get(id)
      if (!organization) throw new HttpError(404, 'Choose an organization.')
      const value = settingsAtScope(defaults, undefined, input.scope, id)
      const inherited = resolveScopedSettings(defaults, undefined, input.scope)
      if (!path.endsWith('/save')) return s.store.publicValue({ value, inherited })
      const save = keepOmittedPlugins(decode(scopedSettingsSaveSchema, raw), value)
      if (save.includeAgents || Object.keys(save.after).some((key) => key !== 'resources'))
        throw new HttpError(
          400,
          'Configure skills, MCP servers and additional instructions at this scope.',
        )
      if (
        !isDeepStrictEqual(
          decode(scopedSettingsValueSchema, s.store.publicValue(value)),
          save.before,
        )
      )
        throw new HttpError(409, 'Settings changed on another device. Reload before saving.')
      const resources = decode(
        resourceSettingsSchema,
        s.store.restoreSecrets(save.after.resources ?? {}),
      )
      if (resources.hooks?.length)
        throw new HttpError(400, 'Configure hooks at the computer or project scope.')
      const next =
        resources.mcpServers.length ||
        resources.skills.length ||
        resources.plugins?.length ||
        resources.additionalInstructions
          ? resources
          : undefined
      if (defaults.sharedOrganizations?.names.some((row) => row.id === id)) {
        const sharedResources = prepareShared({ resources: next }).resources
        s.defaults.mergeOrganizations({
          ...emptySharedOrganizations(),
          resources: [
            {
              id,
              resources: sharedResources ?? null,
              ...organizationRevision(defaults.sharedOrganizations),
            },
          ],
        })
        return s.store.publicValue({
          value: settingsAtScope(s.defaults.get(), undefined, input.scope, id),
          inherited,
        })
      }
      s.defaults.saveOrganizations({
        ...defaults.organizations,
        [id]: { ...organization, resources: next },
      })
      return s.store.publicValue({
        value: settingsAtScope(s.defaults.get(), undefined, input.scope, id),
        inherited,
      })
    }
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
    const legacy = s.store.get().agents
    const stored = settingsAtScope(base, repository, input.scope)
    const includeAgents = input.includeAgents === true
    const legacyAtScope =
      input.scope === 'environment' && stored.agents === undefined
        ? legacy.filter((agent) => !agent.globalPreset || agent.serverOverride)
        : input.scope === 'global' && stored.agents === undefined
          ? legacy.flatMap((agent) => (agent.globalPreset ? [agent.globalPreset] : []))
          : []
    const value = includeAgents
      ? {
          ...stored,
          agents: [
            ...new Map(
              [...legacyAtScope, ...(stored.agents ?? [])].map((agent) => [
                agent.id,
                decode(agentPresetSchema, agent),
              ]),
            ).values(),
          ],
        }
      : stored
    const inherited = {
      ...resolveScopedSettings(base, repository, input.scope),
      ...(includeAgents
        ? {
            agents: scopedAgentEntries(base, repository, legacy, input.scope).map(
              (entry) => entry.agent,
            ),
          }
        : {}),
    }
    if (path.endsWith('/save')) {
      const save = keepOmittedPlugins(decode(scopedSettingsSaveSchema, raw), value)
      if (input.scope === 'project' && save.projectKey !== sharedProjectKey(repository))
        throw new HttpError(409, 'The project remote changed. Reload settings before saving.')
      const visible = decode(scopedSettingsValueSchema, s.store.publicValue(value))
      const groups = includeAgents
        ? (['agents'] as const)
        : Struct.keys(scopedSettingsValueSchema.fields).filter((key) => key !== 'agents')
      const edited = groups.filter((key) => !isDeepStrictEqual(save.before[key], save.after[key]))
      // Independent pages can save concurrently. Only the categories being changed must match.
      if (
        (edited.length ? edited : groups).some(
          (key) => !isDeepStrictEqual(visible[key], save.before[key]),
        )
      )
        throw new HttpError(409, 'Settings changed on another device. Reload before saving.')
      if (!edited.length)
        return s.store.publicValue({ value, inherited, projectKey: sharedProjectKey(repository) })
      const restored = decode(scopedSettingsValueSchema, s.store.restoreSecrets(save.after))
      if (includeAgents) restored.agents ??= []
      let after = edited.reduce<ScopedSettingsValue>(
        (result, key) => ({ ...result, [key]: restored[key] }),
        stored,
      )
      validatePrompts(after)
      if (
        (input.scope === 'global' || input.scope === 'environment') &&
        (after.projectPinned !== undefined || after.projectArchived !== undefined)
      )
        throw new HttpError(400, 'Pin and archive apply to one project.')
      if (input.scope === 'global' || input.scope === 'project') {
        after = prepareShared(after)
        validateShared(after)
      }
      for (const agent of after.agents ?? []) if (agent.acpInstallationId) s.agents.launch(agent)
      if (after.taskDefaults?.harness) {
        validateDefaultHarness(after.taskDefaults.harness)
        if (after.taskDefaults.harness.acpInstallationId)
          s.agents.launch(after.taskDefaults.harness)
      }
      if (includeAgents) {
        // Freeze configurations before removal or override, keeping established sessions intact.
        s.store.update((workspace) => ({
          ...workspace,
          tasks: workspace.tasks.map((task) => {
            if (
              task.harness ||
              !task.agentId ||
              (repository && task.repositoryId !== repository.id)
            )
              return task
            const agent = s.store
              .agentsFor(task.repositoryId)
              .find((entry) => entry.id === task.agentId)
            const harness = agent && decodeResult(taskHarnessSchema, agent)
            return harness?.success
              ? { ...task, agentName: agent?.name, agentIcon: agent?.icon, harness: harness.data }
              : task
          }),
        }))
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
                  pinned: after.projectPinned,
                  archived: after.projectArchived,
                  taskDefaults: after.taskDefaults,
                  taskBehavior: after.taskBehavior,
                  resources: after.resources,
                  prompts: after.prompts,
                  agents: after.agents,
                }
              : repo,
          ),
        }))
        repository = {
          ...repository,
          pinned: after.projectPinned,
          archived: after.projectArchived,
          taskDefaults: after.taskDefaults,
          taskBehavior: after.taskBehavior,
          resources: after.resources,
          prompts: after.prompts,
          agents: after.agents,
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
          updateSharedSettingsEntry(
            key,
            scoped.shared.find((entry) => entry.key === key),
            after,
            { updatedAt, changeId: randomUUID() },
          ),
        ])
        s.defaults.save({ ...current, scopedSettings: scoped }, false)
      }
      return s.store.publicValue({
        value: after,
        inherited,
        projectKey: sharedProjectKey(repository),
      })
    }
    return s.store.publicValue({
      value,
      inherited,
      projectKey: sharedProjectKey(repository),
    })
  })
}

/**
 * Clients that predate plugin activations drop the unknown `plugins` key when they decode and
 * save resources. An omitted key keeps the saved activations; new clients always send the list.
 */
function keepOmittedPlugins<
  S extends {
    before: { resources?: { plugins?: unknown } }
    after: { resources?: { plugins?: unknown } }
  },
>(save: S, current: { resources?: { plugins?: unknown } }): S {
  const plugins = current.resources?.plugins
  if (plugins === undefined) return save
  const keep = <V extends { resources?: { plugins?: unknown } }>(value: V): V =>
    value.resources && !Object.hasOwn(value.resources, 'plugins')
      ? { ...value, resources: { ...value.resources, plugins } }
      : value
  return { ...save, before: keep(save.before), after: keep(save.after) }
}
