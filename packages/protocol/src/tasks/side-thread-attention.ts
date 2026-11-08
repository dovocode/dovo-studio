import type { Task } from '../workspace.js'
import { taskFamilyIds } from './delegation.js'

type AttentionSnapshot = {
  workspace: { tasks: readonly Pick<Task, 'id' | 'delegation' | 'sideThread'>[] }
  approvals: readonly { taskId: string }[]
  questions: readonly { taskId: string; routing?: 'parent' | 'human' }[]
}

export type SideThreadAttention = 'approval' | 'input'

/** Human input in a child or its delegated agents stays discoverable from its parent. */
export function sideThreadAttention(
  snapshot: AttentionSnapshot | null | undefined,
  childId: string,
): SideThreadAttention | undefined {
  if (!snapshot || !snapshot.workspace.tasks.some((task) => task.id === childId)) return
  const family = taskFamilyIds(snapshot.workspace.tasks, childId)
  if (snapshot.approvals.some((approval) => family.has(approval.taskId))) return 'approval'
  if (
    snapshot.questions.some(
      (question) => question.routing !== 'parent' && family.has(question.taskId),
    )
  )
    return 'input'
}

/** Open the owning side chat, whose ordinary conversation renders its family's controls. */
export function sideThreadAttentionTarget(
  snapshot: AttentionSnapshot | null | undefined,
  parentId: string,
): { id: string; kind: SideThreadAttention } | undefined {
  if (!snapshot) return
  let input: { id: string; kind: SideThreadAttention } | undefined
  for (const task of snapshot.workspace.tasks) {
    if (task.sideThread?.parentTaskId !== parentId) continue
    const kind = sideThreadAttention(snapshot, task.id)
    if (kind === 'approval') return { id: task.id, kind }
    if (kind === 'input' && !input) input = { id: task.id, kind }
  }
  return input
}
