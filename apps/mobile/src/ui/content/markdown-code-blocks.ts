import { fromMarkdown } from 'mdast-util-from-markdown'
import type { Nodes } from 'mdast'

export type MarkdownCodePart =
  | { kind: 'markdown'; text: string; offset: number }
  | { kind: 'code'; text: string; language?: string; offset: number }

/** Only complete fenced code at the current tree level can become a native code view. */
export function completedMarkdownFence(text: string, node: Nodes) {
  if (node.type !== 'code') return
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (start === undefined || end === undefined) return
  const raw = text.slice(start, end)
  const opening = raw.match(/^ {0,3}(`{3,}|~{3,})/)
  const closing = raw
    .split('\n')
    .at(-1)
    ?.match(/^ {0,3}(`{3,}|~{3,})\s*$/)
  if (
    !opening ||
    !closing ||
    raw.indexOf('\n') === -1 ||
    opening[1][0] !== closing[1][0] ||
    closing[1].length < opening[1].length
  )
    return
  return { start, end, text: node.value, language: node.lang ?? undefined }
}

/** Extract standalone completed fences; nested lists and unfinished streaming Markdown stay intact. */
export function markdownCodeBlocks(text: string): MarkdownCodePart[] {
  const parts: MarkdownCodePart[] = []
  let offset = 0
  if (/(?:^|\n) {0,3}(?:`{3,}|~{3,})/.test(text)) {
    for (const node of fromMarkdown(text).children) {
      const fence = completedMarkdownFence(text, node)
      if (!fence) continue
      if (fence.start > offset)
        parts.push({ kind: 'markdown', text: text.slice(offset, fence.start), offset })
      parts.push({
        kind: 'code',
        text: fence.text,
        language: fence.language,
        offset: fence.start,
      })
      offset = fence.end
    }
  }
  if (offset < text.length || !parts.length)
    parts.push({ kind: 'markdown', text: text.slice(offset), offset })
  return parts
}
