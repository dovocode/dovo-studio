import type { Task } from '@dovo/studio-core'

export function compactionsByMessage(task: Pick<Task, 'compactions' | 'turns'>) {
  const result = new Map<string, NonNullable<Task['compactions']>>()
  let assistants: Map<string, string> | undefined
  for (const event of task.compactions ?? []) {
    if (event.messageId == null && !assistants) {
      assistants = new Map()
      for (const turn of task.turns ?? []) {
        if (!assistants.has(turn.id)) assistants.set(turn.id, turn.assistantId)
      }
    }
    const messageId = event.messageId ?? assistants?.get(event.turnId)
    if (!messageId) continue
    const events = result.get(messageId) ?? []
    events.push(event)
    result.set(messageId, events)
  }
  return result
}
