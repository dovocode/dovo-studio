import type { RuntimeSnapshot } from '../runtime/connection/runtime.js'
import { resolveTaskDefaults } from '../runtime/connection/runtime-setup.js'
import { resolveScopedAgents } from '../runtime/connection/scoped-settings.js'
import {
  modelDisplayName,
  modelDiscoveryInput,
  modelPreferenceKey,
  type ModelCatalog,
} from './models.js'
import { changeAgentProvider } from './agent-configuration.js'
import { harnessChoiceId } from './harness-availability.js'
import { taskHarnessSchema, type Agent, type TaskHarness } from '../workspace.js'
import { decode } from '../shared/schema.js'
import type { BrowserProfile } from '../runtime/previews/browser-profiles.js'
import type {
  WorkspaceChoice,
  WorkspaceRouteRequest,
  WorkspaceRouteSuggestion,
} from './title-generation.js'

export type WorkspaceModelChoice = { id: string; name: string; harness: TaskHarness }
/** Only configured harnesses and their cached catalogs; classification never launches a provider. */
export async function workspaceModelChoices(
  snapshot: RuntimeSnapshot,
  repositoryId: string,
  cached: (agent: Agent) => Promise<ModelCatalog | null>,
  available?: ReadonlySet<string>,
): Promise<WorkspaceModelChoice[]> {
  const repository = snapshot.workspace.repositories.find((repo) =>
    repositoryId ? repo.id === repositoryId : repo.kind === 'scratch',
  )
  const defaults = resolveTaskDefaults(snapshot.defaults, repository).harness
  const agents = resolveScopedAgents(snapshot.defaults, repository, snapshot.workspace.agents)
  const sources: Agent[] = [
    { ...defaults, id: 'workspace-default', name: defaults.provider },
    ...agents,
  ]
  const catalogs = new Map<string, Promise<ModelCatalog | null>>()
  const sourceChoices = sources.filter(
    (agent) =>
      !available ||
      available.has(
        agent.id === 'workspace-default' ? harnessChoiceId(agent) : `agent:${agent.id}`,
      ),
  )
  for (const agent of sourceChoices) {
    const key = JSON.stringify(modelDiscoveryInput(agent))
    if (!catalogs.has(key)) catalogs.set(key, cached(agent))
  }
  await Promise.all(catalogs.values())
  const choices = new Map<string, WorkspaceModelChoice>()
  const sourceNames = new Map<string, string>()
  for (const agent of sourceChoices) {
    const catalog = await catalogs.get(JSON.stringify(modelDiscoveryInput(agent)))
    const models = [
      ...(agent.model ? [{ id: agent.model, name: modelDisplayName(agent.model) }] : []),
      ...(catalog?.models.filter((model) => !model.hidden) ?? []),
    ]
    for (const model of models) {
      if (
        snapshot.defaults?.modelPreferences?.[
          modelPreferenceKey(agent.provider, model.id, agent.acpInstallationId)
        ]?.disabled ||
        snapshot.defaults?.modelPreferences?.[`agent:${agent.id}`]?.disabled
      )
        continue
      const key = JSON.stringify([
        agent.provider,
        agent.acpInstallationId,
        agent.endpoint,
        agent.executablePath,
        agent.configDirectory,
        agent.args,
        agent.env,
        agent.envSecrets,
        model.id,
      ])
      if (choices.has(key)) continue
      const policy = changeAgentProvider(
        { ...defaults, id: 'workspace-policy', name: 'Workspace' },
        agent.provider,
      )
      const metadata = catalog?.models.find((entry) => entry.id === model.id)
      const harness = decode(taskHarnessSchema, {
        ...agent,
        permission: policy.permission,
        approvalPolicy: policy.approvalPolicy,
        sandboxMode: policy.sandboxMode,
        instructions: defaults.instructions,
        resources: undefined,
        model: model.id,
        reasoning: model.id === agent.model ? agent.reasoning : (metadata?.defaultReasoning ?? ''),
        serviceTier: model.id === agent.model ? agent.serviceTier : metadata?.defaultServiceTier,
      })
      const id = `model:${choices.size}`
      choices.set(key, { id, name: modelDisplayName(model.id, model.name), harness })
      sourceNames.set(id, agent.name)
    }
  }
  const result = [...choices.values()]
  const counts = new Map<string, number>()
  for (const choice of result) counts.set(choice.name, (counts.get(choice.name) ?? 0) + 1)
  return result.map((choice) => ({
    ...choice,
    name:
      (counts.get(choice.name) ?? 0) > 1
        ? `${choice.name} · ${sourceNames.get(choice.id) ?? choice.harness.provider}`
        : choice.name,
  }))
}
export type WorkspaceComputer = { id: string; name: string; snapshot?: RuntimeSnapshot | null }
type Suggestion = WorkspaceRouteSuggestion & {
  runtimeId: string
  repositoryId: string
  model?: WorkspaceModelChoice
  profileId?: string
  profiles?: BrowserProfile[]
}
const keep = (field: string): WorkspaceChoice => ({
  id: 'keep',
  label: `Keep the currently selected ${field}; no available ${field === 'AI model' ? 'model' : field} requested`,
})

/** Stage catalogs after the computer and project decision, so IDs never cross owner/scope boundaries. */
export async function suggestWorkspace(input: {
  text: string
  runtimeId: string
  repositoryId: string
  continueThread?: boolean
  computers: WorkspaceComputer[]
  route: (runtimeId: string, request: WorkspaceRouteRequest) => Promise<WorkspaceRouteSuggestion>
  models: (runtimeId: string, repositoryId: string) => Promise<WorkspaceModelChoice[]>
  profiles: (runtimeId: string, explicitlySelected: boolean) => Promise<BrowserProfile[]>
  current: () => boolean
}): Promise<Suggestion> {
  const owner = input.computers.find((computer) => computer.id === input.runtimeId)
  const supported = owner?.snapshot?.workspaceRoutingSelectionsSupported === true
  const first = await input.route(input.runtimeId, {
    text: input.text,
    ...(supported
      ? {
          catalogs: {
            runtime: [
              keep('computer'),
              ...input.computers.map((computer) => ({
                id: `runtime:${computer.id}`,
                label: `runtime: ${computer.name}`,
              })),
            ],
          },
        }
      : {}),
  })
  const selected = input.computers.find(
    (computer) => `runtime:${computer.id}` === first.selections?.runtime,
  )
  const runtimeId = selected?.id ?? input.runtimeId
  const repositoryId = runtimeId === input.runtimeId ? input.repositoryId : ''
  const result: Suggestion = { ...first, runtimeId, repositoryId }
  if (!input.current() || !supported || !first.selections?.runtime) return result
  if (input.continueThread && first.mode === 'thread' && runtimeId === input.runtimeId)
    return result
  const destination = selected ?? owner
  if (!destination?.snapshot?.workspaceRoutingSelectionsSupported) return result
  const ask = (catalogs: NonNullable<WorkspaceRouteRequest['catalogs']>) =>
    input.route(runtimeId, { text: input.text, mode: first.mode, catalogs })
  if (first.mode === 'browser') {
    const profiles = await input.profiles(runtimeId, !!selected)
    if (!input.current()) return result
    const choice = await ask({
      profile: [
        { id: 'default', label: 'Default browser profile; no available named profile requested' },
        ...profiles
          .filter((profile) => profile.id !== 'default')
          .map((profile) => ({ id: `profile:${profile.id}`, label: `profile: ${profile.name}` })),
      ],
    })
    if (!choice.selections?.profile) return { ...result, mode: choice.mode, reason: choice.reason }
    return {
      ...result,
      profiles,
      profileId:
        profiles.find((profile) => `profile:${profile.id}` === choice.selections?.profile)?.id ??
        'default',
    }
  }
  const projects = destination.snapshot.workspace.repositories.filter(
    (repo) => repo.kind !== 'scratch' && !repo.archived,
  )
  const project = await ask({
    project: [
      keep('project'),
      { id: 'none', label: 'No Project; home folder; outside any repository' },
      ...projects.map((repo) => ({ id: `project:${repo.id}`, label: `project: ${repo.name}` })),
    ],
  })
  if (!project.selections?.project) return { ...result, mode: project.mode, reason: project.reason }
  result.repositoryId =
    project.selections.project === 'none'
      ? ''
      : (projects.find((repo) => `project:${repo.id}` === project.selections?.project)?.id ??
        repositoryId)
  if (first.mode === 'thread' && input.current()) {
    const models = await input.models(runtimeId, result.repositoryId)
    if (!input.current()) return result
    const model = await ask({
      model: [
        keep('AI model'),
        ...models.map((model) => ({ id: model.id, label: `model: ${model.name}` })),
      ],
    })
    if (!model.selections?.model) return { ...result, reason: model.reason }
    result.model = models.find((choice) => choice.id === model.selections?.model)
  }
  return result
}

/** Address extraction only after the user accepts Browser; this never decides the destination. */
export function workspaceBrowserInput(text: string): string {
  const input = text.trim()
  if (!/\s/.test(input)) return input
  const targets: string[] = []
  for (const part of input.split(/\s+/)) {
    const candidate = part.replace(/^["'(<]+|["'>),;]+$/g, '')
    const explicit = /^https?:\/\//i.test(candidate)
    if (
      !explicit &&
      !/^(?:localhost(?::\d+)?|(?:[a-z\d-]+\.)+[a-z]{2,}|(?:\d{1,3}\.){3}\d{1,3})(?::\d+)?(?:[/?#]|$)/i.test(
        candidate,
      )
    )
      continue
    try {
      const url = new URL(explicit ? candidate : `https://${candidate}`)
      if (url.hostname && !url.username && !url.password) targets.push(candidate)
    } catch {
      /* Leave malformed addresses to the browser address validator. */
    }
  }
  return targets.length === 1 ? targets[0]! : input
}
