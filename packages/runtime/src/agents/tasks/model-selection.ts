import {
  acpInstallationHarness,
  changeAgentProvider,
  decode,
  decodeResult,
  defaultTaskHarness,
  modelCatalogSchema,
  modelPreferenceKey,
  mutableStruct,
  providerSchema,
  resolveTaskAgent,
  permissionPolicyWithinCeiling,
  supportsAccess,
  taskHarnessSchema,
  type AcpInstallation,
  type Agent,
  type TaskHarness,
} from '@dovo/protocol'
import { Effect, Schema } from 'effect'
import { isDeepStrictEqual } from 'node:util'
import type Database from 'better-sqlite3'
import { RuntimeDefaults } from '../../storage/runtime-defaults.js'
import { RuntimePreferences } from '../../storage/runtime-preferences.js'
import type { WorkspaceStore } from '../../storage/workspace.js'
import type { AgentRegistry } from '../configuration/registry.js'
import { HarnessAvailabilityCache } from '../catalogs/harness-availability.js'
import { ModelCatalogCache, configuredModelCatalogKey } from '../catalogs/model-cache.js'
import { HttpError, runtimeOperation, runtimeProgram } from '../../errors.js'
import type { TitleGeneration } from './title-generation.js'

type Candidate = {
  discovery: Agent
  generation: string
  id: string
  name: string
  harness: TaskHarness
  description?: string
  specialty?: string
  reasoning: readonly { id: string; name: string }[]
}

/** Resolves only pending first-turn modes. The durable concrete harness owns later turns. */
export class ModelSelection {
  private availability = new HarnessAvailabilityCache()
  private catalogs: ModelCatalogCache
  constructor(
    private db: Database.Database,
    private store: WorkspaceStore,
    private registry: AgentRegistry,
    private titles: TitleGeneration,
    private installations: () => readonly AcpInstallation[] = () => [],
  ) {
    this.catalogs = new ModelCatalogCache(db)
  }

  private requireEnabled() {
    if (!new RuntimePreferences(this.db).get().enableSmartModelSelection)
      throw new HttpError(
        403,
        'Tune and Maestro modes are disabled on this computer. Enable them in settings or choose a model manually.',
      )
  }

  resolveEffect(id: string, text?: string) {
    return runtimeProgram(
      Effect.gen({ self: this }, function* () {
        const before = this.store.task(id)
        if (!before.modelSelection) return
        if (before.modelSelection !== 'inherit') this.requireEnabled()
        if (before.turns?.length || before.sessionId || before.delegation)
          throw new HttpError(409, 'Choose Inherit, Tune or Maestro before the first turn.')
        if (before.autoProject)
          throw new HttpError(409, 'Resolve Scope mode before choosing a model.')
        const projectDefaults = this.store.taskDefaults(before.repositoryId).harness
        const current = resolveTaskAgent(before, this.store.get().agents) ?? projectDefaults
        const policy = changeAgentProvider(
          { ...current, id: 'policy', name: 'Thread permissions' },
          projectDefaults.provider,
        )
        if (
          !permissionPolicyWithinCeiling(current, policy) ||
          !supportsAccess(policy.provider, policy.permission)
        )
          throw new HttpError(
            409,
            'The selected provider cannot preserve this thread’s permissions. Choose a compatible provider manually.',
          )
        const defaults = {
          ...projectDefaults,
          permission: policy.permission,
          approvalPolicy: policy.approvalPolicy,
          sandboxMode: policy.sandboxMode,
        }
        let harness: TaskHarness = defaults
        if (before.modelSelection !== 'inherit') {
          const candidates = yield* runtimeOperation(() =>
            this.candidates(before.repositoryId, defaults, before.modelSelection === 'auto'),
          )
          if (!candidates.length)
            throw new HttpError(
              409,
              'No available models were found. Configure a harness or choose a model manually.',
            )
          const output = yield* this.titles.selectModelEffect(
            JSON.stringify({
              request:
                text ??
                (before.queue?.[0] ?? before.messages.find((message) => message.role === 'user'))
                  ?.text ??
                before.draft,
              project: this.store.get().repositories.find((repo) => repo.id === before.repositoryId)
                ?.name,
              linkedProjects: before.linkedCheckouts?.map((link) => ({
                name: this.store.get().repositories.find((repo) => repo.id === link.repositoryId)
                  ?.name,
                access: link.access,
              })),
              difficulty: before.modelSelectionDifficulty ?? 'auto',
              default: { provider: defaults.provider, model: defaults.model },
              candidates: candidates.map(
                ({ id, name, harness, description, specialty, reasoning }) => ({
                  id,
                  name,
                  provider: harness.provider,
                  model: harness.model,
                  description,
                  specialty,
                  reasoning,
                  defaultReasoning: harness.reasoning,
                  preferred:
                    harness.provider === defaults.provider &&
                    harness.acpInstallationId === defaults.acpInstallationId &&
                    harness.model === defaults.model,
                }),
              ),
            }),
          )
          let raw: unknown
          try {
            raw = JSON.parse(
              output
                .trim()
                .replace(/^```(?:json)?\s*/, '')
                .replace(/\s*```$/, ''),
            )
          } catch {
            throw new HttpError(
              502,
              'Model selection returned invalid JSON. Choose a model manually or try again.',
            )
          }
          const result = decodeResult(
            mutableStruct({
              id: Schema.String,
              reason: Schema.String,
              reasoning: Schema.optional(Schema.String),
            }),
            raw,
          )
          const chosen = result.success
            ? candidates.find((candidate) => candidate.id === result.data.id)
            : undefined
          if (!chosen)
            throw new HttpError(
              502,
              'Model selection returned an unavailable model. Choose a model manually or try again.',
            )
          if (
            configuredModelCatalogKey(chosen.discovery, this.registry, this.installations()) !==
              chosen.generation ||
            new RuntimeDefaults(this.db).get().modelPreferences?.[
              modelPreferenceKey(
                chosen.harness.provider,
                chosen.harness.model,
                chosen.harness.acpInstallationId,
              )
            ]?.disabled
          )
            throw new HttpError(409, 'Model availability changed during selection. Try again.')
          const selectedReasoning = result.success ? result.data.reasoning : undefined
          if (
            selectedReasoning &&
            !chosen.reasoning.some((level) => level.id === selectedReasoning)
          )
            throw new HttpError(
              502,
              'Model selection returned an unsupported reasoning level. Try again or choose a model manually.',
            )
          if (!selectedReasoning && chosen.reasoning.length)
            throw new HttpError(502, 'Model selection did not choose a reasoning level. Try again.')
          harness = { ...chosen.harness, reasoning: selectedReasoning ?? chosen.harness.reasoning }
        }
        if (before.modelSelection !== 'inherit') this.requireEnabled()
        if (
          !isDeepStrictEqual(this.store.task(id), before) ||
          !isDeepStrictEqual(this.store.taskDefaults(before.repositoryId).harness, projectDefaults)
        )
          throw new HttpError(409, 'The thread changed during model selection. Try again.')
        this.store.updateTask(id, (task) => ({
          ...task,
          harness,
          agentId: '',
          agentOverrides: undefined,
          harnessCustomized: true,
          modelSelection: undefined,
          modelSelectionDifficulty: undefined,
        }))
      }),
    )
  }

  private async candidates(repositoryId: string, defaults: TaskHarness, sameHarness: boolean) {
    const preferred: Agent = { ...defaults, id: 'default', name: 'Project/system default' }
    const agents: Agent[] = sameHarness
      ? [preferred]
      : [
          preferred,
          ...providerSchema.literals
            .filter((provider) => provider !== 'acp' && provider !== defaults.provider)
            .map((provider) => ({ ...defaultTaskHarness(provider), id: provider, name: provider })),
          ...this.installations().map((installation) => ({
            ...acpInstallationHarness(installation),
            id: installation.id,
            name: installation.name,
          })),
          ...this.store.agentsFor(repositoryId),
        ]
    const modelPreferences = new RuntimeDefaults(this.db).get().modelPreferences ?? {}
    const candidates: Candidate[] = []
    const seen = new Set<string>()
    let failures = 0
    for (let offset = 0; offset < agents.length; offset += 4) {
      const results = await Promise.allSettled(
        agents.slice(offset, offset + 4).map(async (agent) => {
          if (!(await this.availability.check(agent, this.registry))) return []
          const generation = configuredModelCatalogKey(agent, this.registry, this.installations())
          const adapter = await this.registry.get(agent.provider)
          const models = adapter.models
          const catalog = models
            ? await this.catalogs.get(
                configuredModelCatalogKey(agent, this.registry, this.installations()),
                async () => decode(modelCatalogSchema, await models(agent)),
              )
            : { models: [{ id: '', name: 'Provider default' }], reasoning: [] }
          // Keep account/launch configuration from the candidate; access comes from the project's policy.
          const policy = changeAgentProvider(preferred, agent.provider)
          if (!permissionPolicyWithinCeiling(preferred, policy)) return []
          const base = decode(taskHarnessSchema, {
            ...agent,
            permission: policy.permission,
            approvalPolicy: policy.approvalPolicy,
            sandboxMode: policy.sandboxMode,
          })
          return catalog.models
            .filter(
              (model) =>
                !model.hidden &&
                !modelPreferences[
                  modelPreferenceKey(agent.provider, model.id, agent.acpInstallationId)
                ]?.disabled,
            )
            .map((model) => ({
              discovery: agent,
              generation,
              name: `${agent.name} · ${model.name}`,
              description: model.description,
              specialty: model.specialty,
              reasoning: model.reasoning ?? catalog.reasoning ?? [],
              harness: {
                ...base,
                model: model.id,
                reasoning: model.defaultReasoning,
                serviceTier: undefined,
                cyberAccessProgram: undefined,
              },
            }))
        }),
      )
      for (const result of results) {
        if (result.status === 'rejected') {
          failures++
          continue
        }
        for (const candidate of result.value) {
          const key = JSON.stringify(candidate.harness)
          if (seen.has(key)) continue
          seen.add(key)
          candidates.push({ ...candidate, id: String(candidates.length) })
        }
      }
    }
    if (!candidates.length && failures)
      throw new HttpError(
        502,
        'Could not discover available models. Refresh model discovery or choose a model manually.',
      )
    return candidates
  }
}
