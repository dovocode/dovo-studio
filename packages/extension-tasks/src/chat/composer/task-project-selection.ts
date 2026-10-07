import {
  canChangeTaskCheckout,
  resolveTaskDefaults,
  type Agent,
  type Task,
  type Repository,
  type RuntimeDefaults,
} from '@dovo/protocol'

/** Project defaults configure untouched drafts; an existing model choice stays on this computer. */
export function changeTaskProject(
  task: Task,
  source: Repository | undefined,
  target: Repository,
  runtime: RuntimeDefaults | undefined,
  agents: readonly Pick<Agent, 'id'>[] = [],
): Task {
  if (!canChangeTaskCheckout(task)) throw new Error('Choose the project before sending input.')
  const previous = resolveTaskDefaults(runtime, source).harness
  const defaults = resolveTaskDefaults(runtime, target)
  const selected = task.harness
  // Older drafts have no provenance marker; keep a model/provider that differs
  // from their source defaults as well. New choices are explicit even when equal.
  const changed =
    selected &&
    (selected.provider !== previous.provider ||
      selected.model !== previous.model ||
      selected.acpInstallationId !== previous.acpInstallationId)
  // A draft without a stored harness resolves through its saved configuration;
  // keep that choice while the configuration exists, drop dangling references.
  const savedAgent = !!task.agentId && agents.some((agent) => agent.id === task.agentId)
  const customized =
    !!(selected && (task.harnessCustomized || task.agentId || changed)) || savedAgent
  return {
    ...task,
    ...defaults,
    harness: customized ? selected : defaults.harness,
    harnessCustomized: customized || undefined,
    agentId: customized ? task.agentId : '',
    repositoryId: target.id,
    agentOverrides: customized ? task.agentOverrides : undefined,
    existingWorktreePath: undefined,
    worktreeBaseBranch: undefined,
  }
}
