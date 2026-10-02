import { fromMarkdown } from 'mdast-util-from-markdown'
export type MarkdownPart = { kind: 'markdown' | 'mermaid'; text: string; offset: number }
/** Use Markdown's syntax tree so fences inside other code blocks stay literal. */
export function mermaidBlocks(text: string): MarkdownPart[] {
  const parts: MarkdownPart[] = []
  let offset = 0
  if (/(?:^|\n) {0,3}(?:`{3,}|~{3,})mermaid(?:\s|$)/i.test(text)) {
    for (const node of fromMarkdown(text).children) {
      if (node.type !== 'code' || node.lang?.toLowerCase() !== 'mermaid') continue
      const start = node.position?.start.offset,
        end = node.position?.end.offset
      if (start === undefined || end === undefined) continue
      const raw = text.slice(start, end)
      const opening = raw.match(/^ {0,3}(`{3,}|~{3,})/)
      const closing = raw
        .split('\n')
        .at(-1)
        ?.match(/^ {0,3}(`{3,}|~{3,})\s*$/)
      // An unclosed streaming fence must remain source until its closing line arrives.
      if (
        !opening ||
        !closing ||
        raw.indexOf('\n') === -1 ||
        opening[1][0] !== closing[1][0] ||
        closing[1].length < opening[1].length
      )
        continue
      if (start > offset) parts.push({ kind: 'markdown', text: text.slice(offset, start), offset })
      parts.push({ kind: 'mermaid', text: node.value, offset: start })
      offset = end
    }
  }
  if (offset < text.length || !parts.length)
    parts.push({ kind: 'markdown', text: text.slice(offset), offset })
  return parts
}
