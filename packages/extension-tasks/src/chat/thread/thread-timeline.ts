import type { recentTools } from '@dovo/studio-core'

type Tool = ReturnType<typeof recentTools>[number]
export type ThreadBlock =
  | { kind: 'activity'; offset: number; tools: Tool[] }
  | { kind: 'text'; offset: number; text: string }

/** Tool start offsets are measured against the assistant's accumulated text. */
export function threadTimeline(text: string, tools: Tool[]): ThreadBlock[] {
  const at = new Map<number, Tool[]>()
  for (const tool of tools) {
    const offset = Math.min(text.length, Math.max(0, tool.textOffset ?? 0))
    const group = at.get(offset) ?? []
    group.push(tool)
    at.set(offset, group)
  }
  if (!at.has(0)) at.set(0, [])
  const blocks: ThreadBlock[] = []
  let cursor = 0
  for (const offset of [...at.keys()].sort((a, b) => a - b)) {
    if (offset > cursor)
      blocks.push({ kind: 'text', offset: cursor, text: text.slice(cursor, offset) })
    blocks.push({ kind: 'activity', offset, tools: at.get(offset)! })
    cursor = offset
  }
  if (cursor < text.length) blocks.push({ kind: 'text', offset: cursor, text: text.slice(cursor) })
  return blocks
}
