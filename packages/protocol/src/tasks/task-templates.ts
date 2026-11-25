import type { LinkedCheckout, Task, TaskTemplate } from '../workspace.js'

const templateCheckouts = (links: readonly LinkedCheckout[] | undefined) =>
  links?.map(({ id, repositoryId, execution, baseBranch, access }) => ({
    id,
    repositoryId,
    execution,
    ...(baseBranch ? { baseBranch } : {}),
    access,
  }))
/** Captures a task's goal and settings: its first request (or unsent draft), agent, checkout
 * choice and setup command. Conversation, files and branch are not part of a template. */
export function templateFromTask(
  task: Task,
  name: string,
  id: string,
  includeCheckouts = false,
): TaskTemplate {
  const objective =
    task.messages.find((message) => message.role === 'user' && !message.file)?.text ?? task.draft
  const checkouts = includeCheckouts
    ? templateCheckouts(task.pendingLinkedCheckouts ?? task.linkedCheckouts)
    : undefined
  return {
    id,
    name: name.trim(),
    objective: objective.trim(),
    ...(task.harness ? { harness: task.harness } : task.agentId ? { agentId: task.agentId } : {}),
    ...(task.execution ? { execution: task.execution } : {}),
    ...(task.worktreeFromOrigin !== undefined
      ? { worktreeFromOrigin: task.worktreeFromOrigin }
      : {}),
    ...(task.setupCommand?.trim() ? { setupCommand: task.setupCommand } : {}),
    ...(checkouts?.length ? { linkedCheckouts: checkouts } : {}),
  }
}

/** Fields a new draft takes from a template. The goal lands in the draft, ready to edit. */
export function templateTaskFields(template: TaskTemplate, linkedCheckoutsSupported = false) {
  return {
    draft: template.objective,
    ...(template.harness
      ? { harness: template.harness, agentId: '' }
      : template.agentId
        ? { agentId: template.agentId, harness: undefined }
        : {}),
    ...(template.execution ? { execution: template.execution } : {}),
    ...(template.worktreeFromOrigin !== undefined
      ? { worktreeFromOrigin: template.worktreeFromOrigin }
      : {}),
    ...(template.setupCommand !== undefined ? { setupCommand: template.setupCommand } : {}),
    ...(linkedCheckoutsSupported && template.linkedCheckouts?.length
      ? { linkedCheckouts: templateCheckouts(template.linkedCheckouts) }
      : {}),
  } satisfies Partial<Task>
}
