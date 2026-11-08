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
/** Case- and accent-folded query. Double quotes keep a literal phrase together. */
export function taskSearchNeedle(query: string) {
  return taskSearchText(query.trim())
}
export function taskSearchText(text: string) {
  return text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{M}/gu, '')
    .replace(/ς/g, 'σ')
    .replace(/[‘’]/g, "'")
}
/** Every term must occur in the same message, in any order; no typo matching.
 * Quoted terms retain their internal whitespace and punctuation. */
export function taskSearchTerms(needle: string) {
  return [
    ...new Set(
      Array.from(
        taskSearchNeedle(needle).matchAll(/"([^"]+)"|([^\s"]+)/gu),
        (match) => match[1] ?? match[2]!,
      ),
    ),
  ]
}
/** Source UTF-16 offsets for the first matching term, even when folding expands a character
 * or removes combining marks. Consumers must never slice source text at folded offsets. */
export function taskSearchMatch(text: string, needle: string) {
  const terms = taskSearchTerms(needle)
  if (!terms.length) return undefined
  const folded = taskSearchText(text)
  let first = folded.length
  let last = 0
  for (const term of terms) {
    const at = folded.indexOf(term)
    if (at < 0) return undefined
    if (at < first) {
      first = at
      last = at + term.length
    } else if (at === first) last = Math.max(last, at + term.length)
  }
  if (/^\p{ASCII}*$/u.test(text)) return { start: first, end: last }
  let source = 0
  let offset = 0
  let start = 0
  let end = 0
  for (const character of text) {
    const length = taskSearchText(character).length
    if (offset <= first && first < offset + length) start = source
    if (offset < last) end = source + character.length
    else if (!length) end = source + character.length
    else break
    source += character.length
    offset += length
  }
  return { start, end }
}
/** Most recently active threads first; equal timestamps keep workspace order. */
export function taskSearchOrder<T extends Pick<Task, 'createdAt' | 'updatedAt'>>(
  tasks: readonly T[],
): T[] {
  return [...tasks].sort((a, b) =>
    (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt),
  )
}
/** A matching message's hit, or undefined when any query term is missing. */
export function taskSearchHit(
  taskId: string,
  message: Pick<Task['messages'][number], 'id' | 'role' | 'text'>,
  needle: string,
): TaskSearchHit | undefined {
  const match = taskSearchMatch(message.text, needle)
  if (!match) return undefined
  let start = Math.max(0, match.start - 60),
    end = Math.min(message.text.length, match.end + 100)
  // Context boundaries must not split an astral character either.
  if (start > 0 && /[\udc00-\udfff]/.test(message.text[start]!)) start--
  if (end < message.text.length && /[\udc00-\udfff]/.test(message.text[end]!)) end++
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
