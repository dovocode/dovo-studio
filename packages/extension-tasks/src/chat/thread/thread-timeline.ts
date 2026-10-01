import type { recentTools, Task } from '@dovo/studio-core'

type Tool = ReturnType<typeof recentTools>[number]
type Compaction = NonNullable<Task['compactions']>[number]
export type ThreadBlock =
  | { kind: 'activity'; key: string; offset: number; tools: Tool[] }
  | { kind: 'compaction'; offset: number; event: Compaction }
  | { kind: 'text'; offset: number; text: string }

function displayOffset(text: string, raw: number) {
  const offset = Math.min(text.length, Math.max(0, raw))
  // A tool event can arrive between streamed text chunks while a word is still
  // being emitted. Keep that word (and a nearby sentence ending) together.
  if (!/[\p{L}\p{N}]/u.test(text[offset - 1] ?? '') || !/[\p{L}\p{N}]/u.test(text[offset] ?? ''))
    return offset
  const rest = text.slice(offset, offset + 160)
  const sentence = rest.match(/^[^\n]*?[.!?](?=\s|$)/u)
  if (sentence) return offset + sentence[0].length
  const word = rest.match(/^[\p{L}\p{N}]*/u)
  const end = offset + (word?.[0].length ?? 0)
  return end < text.length ? end : offset
}

/** Tool start offsets are measured against the assistant's accumulated text. */
export function threadTimeline(
  text: string,
  tools: Tool[],
  compactions: Compaction[] = [],
  textBreaks: readonly number[] = [],
): ThreadBlock[] {
  const explicitBreaks = new Set(textBreaks)
  const at = new Map<
    number,
    Array<{ kind: 'tool'; tool: Tool } | { kind: 'compaction'; event: Compaction }>
  >()
  for (const tool of tools) {
    const raw = tool.textOffset ?? 0
    const offset = explicitBreaks.has(raw) ? raw : displayOffset(text, raw)
    const group = at.get(offset) ?? []
    group.push({ kind: 'tool', tool })
    at.set(offset, group)
  }
  for (const event of compactions) {
    const raw = event.textOffset ?? text.length
    const offset = explicitBreaks.has(raw) ? raw : displayOffset(text, raw)
    const group = at.get(offset) ?? []
    group.push({ kind: 'compaction', event })
    at.set(offset, group)
  }
  for (const boundary of textBreaks) {
    const offset = Math.max(0, Math.min(text.length, boundary))
    if (!at.has(offset)) at.set(offset, [])
  }
  if (!at.has(0)) at.set(0, [])
  const blocks: ThreadBlock[] = []
  let cursor = 0
  for (const offset of [...at.keys()].sort((a, b) => a - b)) {
    if (offset > cursor)
      blocks.push({ kind: 'text', offset: cursor, text: text.slice(cursor, offset) })
    const entries = at.get(offset)!.sort((left, right) => {
      const a = left.kind === 'tool' ? (left.tool.startedAt ?? left.tool.time) : left.event.at
      const b = right.kind === 'tool' ? (right.tool.startedAt ?? right.tool.time) : right.event.at
      return a.localeCompare(b)
    })
    if (offset === 0 && entries[0]?.kind === 'compaction')
      blocks.push({ kind: 'activity', key: 'activity:0:start', offset, tools: [] })
    let current: Tool[] = []
    let segment = 'start'
    const flush = () => {
      if (current.length || (!entries.length && offset === 0)) {
        blocks.push({
          kind: 'activity',
          key: `activity:${current.length ? Math.min(...current.map((tool) => tool.textOffset ?? 0)) : offset}:${segment}`,
          offset,
          tools: current,
        })
        current = []
      }
    }
    for (const entry of entries) {
      if (entry.kind === 'tool') current.push(entry.tool)
      else {
        flush()
        blocks.push({ kind: 'compaction', offset, event: entry.event })
        segment = entry.event.at
      }
    }
    flush()
    cursor = offset
  }
  if (cursor < text.length) blocks.push({ kind: 'text', offset: cursor, text: text.slice(cursor) })
  return blocks
}

/** Completed turns keep their last reply visible when work is folded. */
export function finalReplyIndex(blocks: ThreadBlock[], running: boolean) {
  return running
    ? -1
    : blocks.reduce((last, block, index) => (block.kind === 'text' ? index : last), -1)
}
