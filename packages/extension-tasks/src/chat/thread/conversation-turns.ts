import type { Task, TaskTurn } from '@dovo/studio-core'

export type ConversationTurn = {
  id: string
  messages: Task['messages']
  status: TaskTurn['status'] | 'waiting'
}

/** A user request owns all responses and resumed work until the next request. */
export function conversationTurns(task: Pick<Task, 'messages' | 'turns'>): ConversationTurn[] {
  const turns = new Map(task.turns?.map((turn) => [turn.assistantId, turn]))
  const groups: ConversationTurn[] = []
  const runs = new Map<string, string>()
  let nextRun: string | undefined
  for (const message of [...task.messages].reverse()) {
    const turn = turns.get(message.id)
    if (turn) nextRun = turn.runId ?? turn.id
    if (message.role === 'user') {
      if (nextRun) runs.set(message.id, nextRun)
      nextRun = undefined
    }
  }
  let currentRun: string | undefined
  for (const message of task.messages) {
    const run = runs.get(message.id)
    if (!groups.length || (message.role === 'user' && (!run || run !== currentRun))) {
      currentRun = run
      groups.push({ id: message.id, messages: [], status: 'waiting' })
    }
    const group = groups[groups.length - 1]!
    group.messages.push(message)
    const turn = turns.get(message.id)
    // Old imported conversations have no turn records.
    if (turn) group.status = turn.status
    else if (message.role === 'assistant' && message.text.trim()) group.status = 'completed'
  }
  return groups
}

export const conversationTurnLabel = (status: ConversationTurn['status']) =>
  ({
    waiting: 'Awaiting response',
    running: 'Working',
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Stopped',
  })[status]
