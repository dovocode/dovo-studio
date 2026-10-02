import { Schema } from 'effect'
import { mutableArray, mutableStruct } from '../shared/schema.js'
import type { Task } from '../workspace.js'
export const taskSearchSchema = mutableStruct({
  taskIds: mutableArray(Schema.String),
  hits: mutableArray(
    mutableStruct({
      taskId: Schema.String,
      messageId: Schema.String,
      snippet: Schema.String,
      role: Schema.String,
    }),
  ),
})
export function searchTaskMessages(tasks: readonly Task[], query: string, limit = 50) {
  const needle = query.trim().toLowerCase()
  if (!needle) return { taskIds: [], hits: [] }
  const taskIds: string[] = []
  const hits: Schema.Schema.Type<typeof taskSearchSchema>['hits'] = []
  const ordered = [...tasks].sort((a, b) =>
    (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt),
  )
  for (const task of ordered) {
    let matched = false
    for (let at = task.messages.length - 1; at >= 0; at--) {
      const message = task.messages[at]!
      const index = message.text.toLowerCase().indexOf(needle)
      if (index < 0) continue
      matched = true
      if (hits.length >= limit) continue
      const start = Math.max(0, index - 60),
        end = Math.min(message.text.length, index + needle.length + 100)
      hits.push({
        taskId: task.id,
        messageId: message.id,
        role: message.role,
        snippet: `${start ? '…' : ''}${message.text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < message.text.length ? '…' : ''}`,
      })
    }
    if (matched) taskIds.push(task.id)
  }
  return { taskIds, hits }
}
