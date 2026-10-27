import { Schema } from 'effect'
import { mutableArray, mutableStruct } from '../shared/schema.js'
import type { Task } from '../workspace.js'
export const taskSearchSchema = mutableStruct({
  taskIds: mutableArray(Schema.String),
  /** Older matching messages in a single-thread search; omitted for global search. */
  nextBefore: Schema.optional(Schema.String),
  hits: mutableArray(
    mutableStruct({
      taskId: Schema.String,
      messageId: Schema.String,
      snippet: Schema.String,
      role: Schema.String,
    }),
  ),
})
export type TaskSearchResult = Schema.Schema.Type<typeof taskSearchSchema>
export type TaskSearchHit = TaskSearchResult['hits'][number]
/** Case-insensitive substring matching compares this needle with `taskSearchText(message.text)`. */
export function taskSearchNeedle(query: string) {
  return query.trim().toLowerCase()
}
export function taskSearchText(text: string) {
  return text.toLowerCase()
}
/** Most recently active threads first; equal timestamps keep workspace order. */
export function taskSearchOrder<T extends Pick<Task, 'createdAt' | 'updatedAt'>>(
  tasks: readonly T[],
): T[] {
  return [...tasks].sort((a, b) =>
    (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt),
  )
}
/** A matching message's hit, or undefined when it does not contain the needle. */
export function taskSearchHit(
  taskId: string,
  message: Pick<Task['messages'][number], 'id' | 'role' | 'text'>,
  needle: string,
): TaskSearchHit | undefined {
  const index = taskSearchText(message.text).indexOf(needle)
  if (index < 0) return undefined
  const start = Math.max(0, index - 60),
    end = Math.min(message.text.length, index + needle.length + 100)
  return {
    taskId,
    messageId: message.id,
    role: message.role,
    snippet: `${start ? '…' : ''}${message.text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < message.text.length ? '…' : ''}`,
  }
}
export function searchTaskMessages(tasks: readonly Task[], query: string, limit = 50) {
  const needle = taskSearchNeedle(query)
  if (!needle) return { taskIds: [], hits: [] }
  const taskIds: string[] = []
  const hits: TaskSearchHit[] = []
  for (const task of taskSearchOrder(tasks)) {
    let matched = false
    for (let at = task.messages.length - 1; at >= 0; at--) {
      const hit = taskSearchHit(task.id, task.messages[at]!, needle)
      if (!hit) continue
      matched = true
      if (hits.length >= limit) continue
      hits.push(hit)
    }
    if (matched) taskIds.push(task.id)
  }
  return { taskIds, hits }
}
