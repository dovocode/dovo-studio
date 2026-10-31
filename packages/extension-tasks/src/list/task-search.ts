import type { TaskEntry } from './task-collection'
import { taskSearchHit, taskSearchNeedle } from '@dovo/protocol'

/** Letters of the query in order, like "fxlg" for "Fix login"; undefined when they do not all
 * appear. Lower is better: earlier and tighter matches win. */
function fuzzyScore(text: string, query: string) {
  const haystack = text.toLowerCase()
  const needle = query.toLowerCase().replace(/\s+/g, '')
  if (!needle) return 0
  const contiguous = haystack.indexOf(needle)
  if (contiguous >= 0) return contiguous
  let at = -1
  let spread = 0
  for (const char of needle) {
    const next = haystack.indexOf(char, at + 1)
    if (next < 0) return undefined
    spread += at < 0 ? next : next - at
    at = next
  }
  return 1000 + spread
}

/** Tasks for the quick switcher: fuzzy on title, then project and computer. Archived tasks
 * come last; an empty query lists recent activity first. */
export function switcherResults(entries: readonly TaskEntry[], query: string, limit = 30) {
  const scored = entries.flatMap((entry) => {
    const score = Math.min(
      fuzzyScore(entry.task.title, query) ?? Infinity,
      (fuzzyScore(`${entry.projectName} ${entry.source.name}`, query) ?? Infinity) + 500,
    )
    return score === Infinity ? [] : [{ entry, score: score + (entry.task.archivedAt ? 5000 : 0) }]
  })
  const activity = (entry: TaskEntry) => entry.task.updatedAt ?? entry.task.createdAt
  return scored
    .sort((a, b) => a.score - b.score || activity(b.entry).localeCompare(activity(a.entry)))
    .slice(0, limit)
    .map((item) => item.entry)
}

export type MessageHit = { entry: TaskEntry; messageId: string; snippet: string; role: string }

/** Rank the combined computers before limiting; connection order is not recency. */
export function mergeMessageResults(hits: readonly MessageHit[], limit = 50) {
  return [...new Map(hits.map((hit) => [`${hit.entry.key}:${hit.messageId}`, hit])).values()]
    .sort((a, b) =>
      (b.entry.task.updatedAt ?? b.entry.task.createdAt).localeCompare(
        a.entry.task.updatedAt ?? a.entry.task.createdAt,
      ),
    )
    .slice(0, limit)
}

/** Messages containing every query term, newest tasks first, with a snippet
 * centred on the match. */
export function messageResults(entries: readonly TaskEntry[], query: string, limit = 50) {
  const needle = taskSearchNeedle(query)
  if (needle.length < 2) return []
  const hits: MessageHit[] = []
  const ordered = [...entries].sort((a, b) =>
    (b.task.updatedAt ?? b.task.createdAt).localeCompare(a.task.updatedAt ?? a.task.createdAt),
  )
  for (const entry of ordered)
    for (const message of [...entry.task.messages].reverse()) {
      const hit = taskSearchHit(entry.task.id, message, needle)
      if (!hit) continue
      hits.push({
        entry,
        messageId: message.id,
        role: message.role,
        snippet: hit.snippet,
      })
      if (hits.length >= limit) return hits
    }
  return hits
}
