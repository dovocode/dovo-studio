import type { Task, TaskSummary, TaskTurn } from '@dovo/protocol'

/** Where one routine message stands in its Bot thread. Only that message's own turn
 * decides the step; other Bot work (people, other routines, children) never does. */
export type BotStepState =
  | { kind: 'missing' }
  | { kind: 'queued' }
  /** Taken from the queue; its turn has not started yet. `owned`: the active run took exactly
   * this message (its persisted `runAttempt.inputMessageIds`). */
  | { kind: 'starting'; owned: boolean }
  | { kind: 'running'; turn: TaskTurn }
  | { kind: 'completed'; turn: TaskTurn }
  | { kind: 'failed'; error: string; turn?: TaskTurn }

/** The latest attempt of the turn that consumed `messageId`. A restarted run keeps its
 * `runId` and adds a new turn entry, so the newest entry of that run is authoritative. */
export function botStepTurn(history: Pick<Task, 'messages' | 'turns'>, messageId: string) {
  const turnId = history.messages.find((message) => message.id === messageId)?.turnId
  if (!turnId) return undefined
  const turns = history.turns ?? []
  const runId = turns.find((turn) => turn.id === turnId)?.runId
  return turns.filter((turn) => turn.id === turnId || (!!runId && turn.runId === runId)).at(-1)
}

export function botStepState(
  summary: Pick<
    TaskSummary,
    'queue' | 'status' | 'activeRunId' | 'error' | 'restartRecovery' | 'runAttempt'
  >,
  history: Pick<Task, 'messages' | 'turns'>,
  messageId: string,
): BotStepState {
  if (summary.queue?.some((item) => item.id === messageId)) return { kind: 'queued' }
  const message = history.messages.find((item) => item.id === messageId)
  if (!message) return { kind: 'missing' }
  const turn = botStepTurn(history, messageId)
  if (!turn) {
    // A message leaves the queue only when a run takes it. If that run ended before its
    // turn began, the thread reports why.
    const owned =
      summary.status === 'running' &&
      !!summary.activeRunId &&
      !!summary.runAttempt?.inputMessageIds.includes(messageId)
    if (summary.status === 'running' && summary.activeRunId) return { kind: 'starting', owned }
    if (summary.status === 'failed' || summary.status === 'cancelled')
      return {
        kind: 'failed',
        error:
          summary.error ??
          (summary.status === 'cancelled'
            ? 'The Bot turn was stopped'
            : 'The Bot turn could not start'),
      }
    return { kind: 'starting', owned: false }
  }
  if (turn.status === 'running') return { kind: 'running', turn }
  if (turn.status === 'completed') return { kind: 'completed', turn }
  // A restart marks the running turn failed. Automatic recovery continues the same run with a
  // new turn entry, so the message is not lost; wait for it instead of sending it again.
  if (
    summary.restartRecovery?.kind === 'turn' &&
    summary.restartRecovery.automatic &&
    history.turns?.at(-1) === turn
  )
    return { kind: 'starting', owned: false }
  return {
    kind: 'failed',
    turn,
    error: turn.error ?? `The Bot turn ${turn.status === 'cancelled' ? 'was stopped' : 'failed'}`,
  }
}
