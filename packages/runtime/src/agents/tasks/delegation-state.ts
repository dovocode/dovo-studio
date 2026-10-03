import { resolveTaskAgent, type Task, type Agent, type Subagent } from '@dovo/protocol'
import { isDeepStrictEqual } from 'node:util'
/** Derived metadata only; the child's conversation remains the authoritative result. */
export function projectDelegatedAgents(tasks: Task[], agents: Agent[]) {
  const children = new Map<string, Task[]>()
  for (const task of tasks)
    if (task.delegation) {
      const group = children.get(task.delegation.parentTaskId) ?? []
      group.push(task)
      children.set(task.delegation.parentTaskId, group)
    }
  if (!children.size) return tasks
  return tasks.map((parent) => {
    const group = children.get(parent.id)
    if (!group) return parent
    const records = parent.subagents ?? []
    const merged = new Map(records.map((agent) => [agent.id, agent]))
    for (const child of group) {
      const agent = resolveTaskAgent(child, agents)
      const status: Subagent['status'] =
        child.activeRunId || child.status === 'running' || child.status === 'draft'
          ? 'working'
          : child.status === 'review' || child.status === 'done'
            ? 'completed'
            : child.status === 'cancelled'
              ? 'stopped'
              : 'failed'
      const old = merged.get(child.id)
      const finishedAt =
        status === 'working'
          ? undefined
          : (child.turns?.at(-1)?.finishedAt ?? child.updatedAt ?? child.createdAt)
      const next: Subagent = {
        id: child.id,
        source: 'dovo',
        taskId: child.id,
        provider: agent?.provider ?? 'unknown',
        name: child.title,
        status,
        prompt: child.messages.find((message) => message.role === 'user')?.text,
        model: agent?.model,
        reasoning: agent?.reasoning,
        activity: child.error ?? child.activity,
        startedAt: child.createdAt,
        updatedAt: old?.updatedAt ?? child.createdAt,
        finishedAt,
      }
      if (!isDeepStrictEqual(next, old))
        merged.set(child.id, { ...next, updatedAt: child.updatedAt ?? child.createdAt })
    }
    const subagents = [...merged.values()]
    return isDeepStrictEqual(subagents, records) ? parent : { ...parent, subagents }
  })
}
