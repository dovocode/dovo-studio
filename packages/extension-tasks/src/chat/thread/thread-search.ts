import type { Task } from '@dovo/studio-core'
import { taskSearchHit, taskSearchNeedle } from '@dovo/protocol'

export function searchThread(messages: Task['messages'], query: string) {
  const needle = taskSearchNeedle(query)
  if (!needle) return []
  return messages.flatMap((message) => {
    const hit = taskSearchHit('', message, needle)
    if (!hit) return []
    return [
      {
        id: message.id,
        role: message.role,
        preview: hit.snippet,
      },
    ]
  })
}
