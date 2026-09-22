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
  for (const message of task.messages) {
    if (message.role === 'user' || !groups.length) {
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
