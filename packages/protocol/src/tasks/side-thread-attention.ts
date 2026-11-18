import type { Task } from '../workspace.js'
import { taskFamilyIds } from './delegation.js'

type AttentionSnapshot = {
  runtimeId?: string
  workspace: {
    tasks: readonly Pick<Task, 'id' | 'delegation' | 'sideThread' | 'botJob' | 'botMention'>[]
  }
  approvals: readonly { id: string; taskId: string }[]
  questions: readonly { id: string; taskId: string; routing?: 'parent' | 'human' }[]
}

export type SideThreadAttention = 'approval' | 'input'
export type SideThreadRequest = { id: string; kind: SideThreadAttention; requestId: string }

/** Human input in a child or its delegated agents stays discoverable from its parent. */
export function sideThreadAttention(
  snapshot: AttentionSnapshot | null | undefined,
  childId: string,
): SideThreadAttention | undefined {
  return sideThreadRequest(snapshot, childId)?.kind
}

export function sideThreadRequest(
  snapshot: AttentionSnapshot | null | undefined,
  childId: string,
): SideThreadRequest | undefined {
  if (!snapshot || !snapshot.workspace.tasks.some((task) => task.id === childId)) return
  const family = taskFamilyIds(snapshot.workspace.tasks, childId)
  const approval = snapshot.approvals.find((request) => family.has(request.taskId))
  if (approval) return { id: childId, kind: 'approval', requestId: approval.id }
  const question = snapshot.questions.find(
    (request) => request.routing !== 'parent' && family.has(request.taskId),
  )
  if (question) return { id: childId, kind: 'input', requestId: question.id }
}

/** Open the owning side chat, whose ordinary conversation renders its family's controls. */
export function sideThreadAttentionTarget(
  snapshot: AttentionSnapshot | null | undefined,
  parentId: string,
): SideThreadRequest | undefined {
  if (!snapshot) return
  let input: SideThreadRequest | undefined
  for (const task of snapshot.workspace.tasks) {
    if (
      task.sideThread?.parentTaskId !== parentId &&
      task.botJob?.botId !== parentId &&
      !(
        task.botMention?.botId === parentId &&
        !!snapshot.runtimeId &&
        task.botMention.runtimeId === snapshot.runtimeId
      )
    )
      continue
    const target = sideThreadRequest(snapshot, task.id)
    if (target?.kind === 'approval') return target
    if (target && !input) input = target
  }
  return input
}
