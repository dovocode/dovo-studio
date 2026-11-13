import type { Task } from '../workspace.js'
/** Match only the request's actual turn. Routine reports and unrelated replies are never read aloud. */
export function botCallReplies(task: Task, ids?: readonly string[]) {
  const wanted = ids && new Set(ids)
  const messages = task.messages.filter(
    (m) => m.role === 'user' && m.turnId && (!wanted || wanted.has(m.id)),
  )
  const turns = new Map(task.turns?.map((t) => [t.id, t]))
  const texts = new Map<string, string[]>()
  const eligible = new Set(messages.map((m) => m.turnId))
  for (const message of task.messages) {
    if (
      message.role !== 'assistant' ||
      !message.turnId ||
      !eligible.has(message.turnId) ||
      message.source
    )
      continue
    const group = texts.get(message.turnId) ?? []
    group.push(message.text)
    texts.set(message.turnId, group)
  }
  return messages.map((message) => {
    const turn = turns.get(message.turnId!)
    const failed = turn?.status === 'failed' || turn?.status === 'cancelled'
    return {
      id: message.id,
      status: failed
        ? ('failed' as const)
        : turn?.status === 'completed'
          ? ('completed' as const)
          : ('waiting' as const),
      text: texts.get(message.turnId!)?.join('\n\n') ?? '',
      error: failed ? turn.error : undefined,
    }
  })
}
