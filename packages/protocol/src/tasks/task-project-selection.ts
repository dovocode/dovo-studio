import type { TaskSummary } from './task-summary.js'
import { canChangeTaskCheckout, type Agent, type Task, type Repository } from '../workspace.js'
import { resolveTaskDefaults, type RuntimeDefaults } from '../runtime/connection/runtime-setup.js'

/** Project defaults configure untouched drafts; an existing model choice stays on this computer. */
export function changeTaskProject<T extends Task | TaskSummary>(
  task: T,
  source: Repository | undefined,
  target: Repository,
  runtime: RuntimeDefaults | undefined,
  agents: readonly Pick<Agent, 'id'>[] = [],
): T {
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
    !task.modelSelection &&
    (!!(selected && (task.harnessCustomized || task.agentId || changed)) || savedAgent)
  return {
    ...task,
    ...defaults,
    harness: customized ? selected : defaults.harness,
    modelSelection: task.modelSelection ?? (customized ? undefined : defaults.modelSelection),
    harnessCustomized: task.modelSelection ? task.harnessCustomized : customized || undefined,
    agentId: customized ? task.agentId : '',
    repositoryId: target.id,
    autoProject: undefined,
    autoProjectExecution: undefined,
    agentOverrides: customized ? task.agentOverrides : undefined,
    existingWorktreePath: undefined,
    worktreeBaseBranch: undefined,
  }
}

/** Automatic modes are draft-only; the runtime freezes the resolved harness before input. */
export function changeTaskModelSelection<T extends Task | TaskSummary>(
  task: T,
  modelSelection: NonNullable<Task['modelSelection']>,
  repository: Repository | undefined,
  runtime: RuntimeDefaults | undefined,
): T {
  if (!canChangeTaskCheckout(task) || task.delegation)
    throw new Error('Choose an automatic model mode before sending input.')
  return {
    ...task,
    modelSelection,
    harness: resolveTaskDefaults(runtime, repository).harness,
    harnessCustomized: true,
    agentId: '',
    agentOverrides: undefined,
  }
}

/** AUTO projects have a separate model-mode default from ordinary task defaults. */
export function changeTaskAutoProject<T extends Task | TaskSummary>(
  task: T,
  source: Repository | undefined,
  scratch: Repository,
  runtime: RuntimeDefaults | undefined,
  agents: readonly Pick<Agent, 'id'>[] = [],
  defaultMode: NonNullable<Task['modelSelection']> = 'inherit',
): T {
  const mode =
    task.harnessCustomized && (task.modelSelection === 'auto' || task.modelSelection === 'smart')
      ? task.modelSelection
      : defaultMode
  const next = changeTaskProject(task, source, scratch, runtime, agents)
  return {
    ...changeTaskModelSelection(next, mode, scratch, runtime),
    autoProject: true,
    autoProjectExecution: task.autoProjectExecution,
  }
}
