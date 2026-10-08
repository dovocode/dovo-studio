import type { Task, TaskTemplate } from '../workspace.js'

/** Captures a task's goal and settings: its first request (or unsent draft), agent, checkout
 * choice and setup command. Conversation, files and branch are not part of a template. */
export function templateFromTask(task: Task, name: string, id: string): TaskTemplate {
  const objective =
    task.messages.find((message) => message.role === 'user' && !message.file)?.text ?? task.draft
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
  }
}

/** Fields a new draft takes from a template. The goal lands in the draft, ready to edit. */
export function templateTaskFields(template: TaskTemplate) {
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
  } satisfies Partial<Task>
}
