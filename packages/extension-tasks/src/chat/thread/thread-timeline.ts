import type { recentTools, Task } from '@dovo/studio-core'

type Tool = ReturnType<typeof recentTools>[number]
type Compaction = NonNullable<Task['compactions']>[number]
export type ThreadBlock =
  | { kind: 'activity'; offset: number; tools: Tool[] }
  | { kind: 'compaction'; offset: number; event: Compaction }
  | { kind: 'text'; offset: number; text: string }

/** Tool start offsets are measured against the assistant's accumulated text. */
export function threadTimeline(
  text: string,
  tools: Tool[],
  compactions: Compaction[] = [],
): ThreadBlock[] {
  const at = new Map<
    number,
    Array<{ kind: 'tool'; tool: Tool } | { kind: 'compaction'; event: Compaction }>
  >()
  for (const tool of tools) {
    const offset = Math.min(text.length, Math.max(0, tool.textOffset ?? 0))
    const group = at.get(offset) ?? []
    group.push({ kind: 'tool', tool })
    at.set(offset, group)
  }
  for (const event of compactions) {
    const offset = Math.min(text.length, Math.max(0, event.textOffset ?? text.length))
    const group = at.get(offset) ?? []
    group.push({ kind: 'compaction', event })
    at.set(offset, group)
  }
  if (!at.has(0)) at.set(0, [])
  const blocks: ThreadBlock[] = []
  let cursor = 0
  for (const offset of [...at.keys()].sort((a, b) => a - b)) {
    if (offset > cursor)
      blocks.push({ kind: 'text', offset: cursor, text: text.slice(cursor, offset) })
    const entries = at.get(offset)!.sort((left, right) => {
      const a = left.kind === 'tool' ? left.tool.time : left.event.at
      const b = right.kind === 'tool' ? right.tool.time : right.event.at
      return a.localeCompare(b)
    })
    if (offset === 0 && entries[0]?.kind === 'compaction')
      blocks.push({ kind: 'activity', offset, tools: [] })
    let current: Tool[] = []
    const flush = () => {
      if (current.length || (!entries.length && offset === 0)) {
        blocks.push({ kind: 'activity', offset, tools: current })
        current = []
      }
    }
    for (const entry of entries) {
      if (entry.kind === 'tool') current.push(entry.tool)
      else {
        flush()
        blocks.push({ kind: 'compaction', offset, event: entry.event })
      }
    }
    flush()
    cursor = offset
  }
  if (cursor < text.length) blocks.push({ kind: 'text', offset: cursor, text: text.slice(cursor) })
  return blocks
}
