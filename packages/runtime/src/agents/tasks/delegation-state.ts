import {
  resolveTaskAgent,
  indexTaskFamilyWorking,
  type Task,
  type Agent,
  type Subagent,
} from '@dovo/protocol'
import { isDeepStrictEqual } from 'node:util'
/** Dovo-owned records mirror child tasks in this workspace; provider-native records
 * (no `source`) come from the harness itself and are never derived here. */
function ownedBy(record: Subagent) {
  return record.source === 'dovo' ? (record.taskId ?? record.id) : undefined
}
/** Derived metadata only; the child's conversation remains the authoritative result.
 * Records for children that no longer exist are dropped so parents never link to a
 * missing task. */
export function projectDelegatedAgents(tasks: Task[], agents: Agent[]) {
  const familyWorking = indexTaskFamilyWorking(tasks)
  const children = new Map<string, Task[]>()
  for (const task of tasks)
    if (task.delegation) {
      const group = children.get(task.delegation.parentTaskId) ?? []
      group.push(task)
      children.set(task.delegation.parentTaskId, group)
    }
  return tasks.map((parent) => {
    const group = children.get(parent.id) ?? []
    const records = parent.subagents ?? []
    if (!group.length && !records.some((record) => ownedBy(record) !== undefined)) return parent
    const current = new Set(group.map((child) => child.id))
    const merged = new Map(
      records
        .filter((record) => {
          const childId = ownedBy(record)
          return childId === undefined || current.has(childId)
        })
        .map((record) => [record.id, record]),
    )
    for (const child of group) {
      const agent = resolveTaskAgent(child, agents)
      const status: Subagent['status'] = familyWorking(child.id)
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
        activity:
          child.error ??
          child.activity ??
          (status === 'working' && child.status === 'review' ? 'Waiting for children' : undefined),
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
