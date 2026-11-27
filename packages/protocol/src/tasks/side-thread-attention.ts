import type { Task } from '../workspace.js'
import { taskFamilyIds } from './delegation.js'
import { botInvocationParent, invokedBotId } from './thread-parent.js'

type AttentionSnapshot = {
  runtimeId?: string
  revision?: number
  workspace: {
    tasks: readonly Pick<
      Task,
      'id' | 'delegation' | 'sideThread' | 'bot' | 'botJob' | 'botMention'
    >[]
  }
  approvals: readonly { id: string; taskId: string }[]
  questions: readonly { id: string; taskId: string; routing?: 'parent' | 'human' }[]
}

export type SideThreadAttention = 'approval' | 'input'
export type SideThreadRequest = { id: string; kind: SideThreadAttention; requestId: string }
type Peer = { connected?: boolean; profile: { id: string }; snapshot?: AttentionSnapshot | null }
export type RoutedSideThreadRequest = SideThreadRequest & {
  owner?: { runtimeId: string; runtimeIdentity: string }
}

/** Choose one view per physical computer before reading its children or their pending requests. */
export function sideThreadPeers<T extends Peer>(peers: readonly T[], activeIdentity?: string) {
  const selected = new Map<string, T>()
  for (const peer of peers) {
    if (!peer.snapshot || (activeIdentity && peer.snapshot.runtimeId === activeIdentity)) continue
    const key = peer.snapshot.runtimeId
      ? `runtime:${peer.snapshot.runtimeId}`
      : `profile:${peer.profile.id}`
    const prior = selected.get(key)
    if (
      !prior ||
      (peer.connected && !prior.connected) ||
      (!!peer.connected === !!prior.connected &&
        (peer.snapshot.revision ?? 0) > (prior.snapshot?.revision ?? 0))
    )
      selected.set(key, peer)
  }
  return [...selected.values()]
}

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
  if (
    !snapshot ||
    (!snapshot.approvals.length && !snapshot.questions.length) ||
    !snapshot.workspace.tasks.some((task) => task.id === childId)
  )
    return
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
  peers: readonly Peer[] = [],
): RoutedSideThreadRequest | undefined {
  if (!snapshot) return
  let input: RoutedSideThreadRequest | undefined
  const parentIsBot = snapshot.workspace.tasks.some((task) => task.id === parentId && task.bot)
  const sources = [
    { snapshot, owner: undefined },
    ...sideThreadPeers(peers, snapshot.runtimeId).flatMap((peer) =>
      snapshot.runtimeId && peer.snapshot?.runtimeId
        ? [
            {
              snapshot: peer.snapshot,
              owner: { runtimeId: peer.profile.id, runtimeIdentity: peer.snapshot.runtimeId },
            },
          ]
        : [],
    ),
  ]
  for (const source of sources) {
    if (!source.snapshot.approvals.length && !source.snapshot.questions.length) continue
    for (const task of source.snapshot.workspace.tasks) {
      if (!source.owner && task.id === parentId) continue
      const call = botInvocationParent(task, source.snapshot.runtimeId)
      const sideCall =
        call?.threadId === parentId &&
        !call.subthread &&
        call.runtimeIdentity === snapshot.runtimeId
      const botWorker =
        parentIsBot && !source.owner && invokedBotId(task, snapshot.runtimeId) === parentId
      if (
        !sideCall &&
        !botWorker &&
        (source.owner ||
          (task.sideThread?.parentTaskId !== parentId && task.botJob?.botId !== parentId))
      )
        continue
      const target = sideThreadRequest(source.snapshot, task.id)
      if (!target) continue
      const routed = source.owner ? { ...target, owner: source.owner } : target
      if (target.kind === 'approval') return routed
      input ??= routed
    }
  }
  return input
}
