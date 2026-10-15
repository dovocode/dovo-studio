import { fromMarkdown } from 'mdast-util-from-markdown'

export type MarkdownCodePart =
  | { kind: 'markdown'; text: string; offset: number }
  | { kind: 'code'; text: string; language?: string; offset: number }

/** Extract standalone completed fences; nested lists and unfinished streaming Markdown stay intact. */
export function markdownCodeBlocks(text: string): MarkdownCodePart[] {
  const parts: MarkdownCodePart[] = []
  let offset = 0
  if (/(?:^|\n) {0,3}(?:`{3,}|~{3,})/.test(text)) {
    for (const node of fromMarkdown(text).children) {
      if (node.type !== 'code') continue
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start === undefined || end === undefined) continue
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
        continue
      if (start > offset) parts.push({ kind: 'markdown', text: text.slice(offset, start), offset })
      parts.push({
        kind: 'code',
        text: node.value,
        language: node.lang ?? undefined,
        offset: start,
      })
      offset = end
    }
  }
  if (offset < text.length || !parts.length)
    parts.push({ kind: 'markdown', text: text.slice(offset), offset })
  return parts
}
