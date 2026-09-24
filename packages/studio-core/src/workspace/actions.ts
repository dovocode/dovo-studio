import type { Task, Workspace } from './schema'
export function updateTask(
  workspace: Workspace,
  id: string,
  update: (task: Task) => Task,
): Workspace {
  return {
    ...workspace,
    tasks: workspace.tasks.map((task) => (task.id === id ? update(task) : task)),
  }
}
export function createTask(
  input: Pick<
    Task,
    | 'title'
    | 'agentId'
    | 'repositoryId'
    | 'execution'
    | 'harness'
    | 'worktreeBaseBranch'
    | 'setupCommand'
  > & {
    objective: string
    origin?: string
  },
): Task {
  return {
    id: crypto.randomUUID(),
    title: input.title,
    repositoryId: input.repositoryId,
    agentId: input.agentId,
    harness: input.harness,
    execution: input.execution,
    worktreeBaseBranch: input.worktreeBaseBranch,
    setupCommand: input.setupCommand,
    status: 'draft',
    createdAt: new Date().toISOString(),
    messages: input.objective.trim()
      ? [{ id: crypto.randomUUID(), role: 'user', text: input.objective }]
      : [],
    files: [],
    draft: '',
    example: false,
    ...(input.origin ? { origin: input.origin } : {}),
  }
}
