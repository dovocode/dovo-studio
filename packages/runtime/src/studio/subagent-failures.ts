import {
  buildThreadTree,
  threadDescendants,
  indexTaskSubagents,
  nativeFailureKey,
  threadNativeAgentOverflow,
} from '@dovo/protocol'
import type { Services } from '../services.js'
import { HttpError } from '../errors.js'

/** Acknowledge an observed failure, without hiding a newer attempt or granting remote access. */
export function acknowledgeSubagentFailure(s: Services, id: string, key: string) {
  const tasks = s.store
    .get()
    .tasks.map((task) => ({ ...task, threadWatches: s.threadWatch.list(task.id) }))
  const parent = tasks.find((task) => task.id === id)
  if (!parent) throw new HttpError(404, 'Thread not found')
  const tree = buildThreadTree(
    tasks.map((task) => ({
      key: JSON.stringify(['local', task.id]),
      task,
      needsInput: false,
      projectName: '',
      source: {
        runtimeId: 'local',
        name: 'This computer',
        online: true,
        snapshot: { runtimeId: s.runtimeId, questions: [], approvals: [] },
      },
    })),
  )
  const children = tree.nodes.get(JSON.stringify(['local', id]))?.children ?? []
  const keys = new Set(
    threadDescendants(children).flatMap((child) =>
      child.phase === 'failed' && child.failureKey ? [child.failureKey] : [],
    ),
  )
  for (const child of threadDescendants(children)) {
    if (child.nativeAgentOverflow?.failed && child.nativeAgentOverflow.failureKey)
      keys.add(child.nativeAgentOverflow.failureKey)
    for (const agent of child.nativeAgents ?? []) if (agent.status === 'failed') keys.add(agent.key)
  }
  const overflowOwners = new Set<string>()
  for (const agent of indexTaskSubagents(tasks)(parent)) {
    const owner = tasks.find((task) => task.subagents?.includes(agent))
    if (owner && !overflowOwners.has(owner.id)) {
      overflowOwners.add(owner.id)
      const overflow = threadNativeAgentOverflow(owner)
      if (overflow?.failed && overflow.failureKey) keys.add(overflow.failureKey)
    }
    if (owner && agent.source !== 'dovo' && agent.status === 'failed')
      keys.add(nativeFailureKey(owner.id, agent))
    if (agent.source === 'dovo') {
      // Local Dovo rows use their authoritative child task outcome, not stale provider metadata.
      const child = tree.nodes.get(JSON.stringify(['local', agent.taskId ?? agent.id]))
      if (child?.phase === 'failed' && child.failureKey) keys.add(child.failureKey)
    }
  }
  if (!keys.has(key))
    throw new HttpError(409, 'This failure changed. Refresh before acknowledging it.')
  s.store.updateTask(id, (task) => ({
    ...task,
    acknowledgedSubagentFailures: [
      ...new Set([...(task.acknowledgedSubagentFailures ?? []), key]),
    ].slice(-200),
  }))
}
