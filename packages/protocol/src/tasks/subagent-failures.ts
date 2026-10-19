import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import type { TaskMetadata } from './task-summary.js'
import { nativeAgentWorking, type Subagent } from '../conversation/workflow/subagents.js'

const digest = (value: unknown) => bytesToHex(sha256(utf8ToBytes(JSON.stringify(value))))
/** Watch refreshes and acknowledgement writes do not create a new execution failure. */
export function taskFailureVersion(
  task: Pick<TaskMetadata, 'failureVersion' | 'runAttempt' | 'historyRevision' | 'error'>,
) {
  return (
    task.failureVersion ??
    digest([
      task.runAttempt && [
        task.runAttempt.runId,
        task.runAttempt.inputMessageIds,
        task.runAttempt.promptAccepted,
      ],
      task.historyRevision,
      task.error,
    ])
  )
}
export function threadFailureKey(runtimeId: string | null, threadId: string, version: string) {
  return digest(['thread', runtimeId, threadId, version])
}
export function nativeFailureKey(ownerId: string, agent: Subagent) {
  return digest([
    'native',
    ownerId,
    agent.provider,
    agent.sessionId,
    agent.id,
    agent.startedAt,
    agent.finishedAt ?? agent.startedAt,
  ])
}
export function subagentVisible(
  agent: Pick<Subagent, 'status' | 'finishedAt'>,
  hideFinished: boolean,
  failureAcknowledged = false,
) {
  return (
    !hideFinished ||
    (!agent.finishedAt && ['working', 'unknown'].includes(agent.status)) ||
    (agent.status === 'failed' && !failureAcknowledged)
  )
}

/** Bounded, credential-free native-agent facts for remote thread summaries. */
function allThreadNativeAgents(task: Pick<TaskMetadata, 'id' | 'subagents'>) {
  return (task.subagents ?? [])
    .filter((agent) => agent.source !== 'dovo')
    .map((agent) => ({
      key: nativeFailureKey(task.id, agent),
      name: agent.name.slice(0, 1000),
      status: agent.status,
      working: nativeAgentWorking(agent),
    }))
    .sort(
      (a, b) =>
        Number(b.status === 'failed') - Number(a.status === 'failed') ||
        Number(b.working) - Number(a.working),
    )
}

export function threadNativeAgents(task: Pick<TaskMetadata, 'id' | 'subagents'>) {
  return allThreadNativeAgents(task).slice(0, 40)
}

/** An execution-scoped group acknowledgement keeps overflow bounded without losing failures. */
export function threadNativeAgentOverflow(task: Pick<TaskMetadata, 'id' | 'subagents'>) {
  const omitted = allThreadNativeAgents(task).slice(40)
  if (!omitted.length) return undefined
  const failed = omitted.filter((agent) => agent.status === 'failed')
  return {
    total: omitted.length,
    working: omitted.filter((agent) => agent.working).length,
    failed: failed.length,
    failureKey: failed.length
      ? digest(['native-overflow', task.id, failed.map((agent) => agent.key).sort()])
      : undefined,
  }
}
