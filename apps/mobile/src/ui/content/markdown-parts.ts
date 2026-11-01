import { cachedMarkdownParts, richMarkdown, type RichMarkdownPart } from '@dovo/protocol'
import { fromMarkdown } from 'mdast-util-from-markdown'
import type { Nodes } from 'mdast'
import { markdownImages, markdownImagesFromNodes, type MarkdownImagePart } from './markdown-images'
import { completedMarkdownFence, type MarkdownCodePart } from './markdown-code-blocks'

export type NativeMarkdownPart =
  | Exclude<RichMarkdownPart, { kind: 'markdown' }>
  | { kind: 'mermaid'; text: string; offset: number }
  | MarkdownCodePart
  | Extract<MarkdownImagePart, { kind: 'image' }>
function containsDefinition(node: Nodes): boolean {
  return (
    node.type === 'definition' || ('children' in node && node.children.some(containsDefinition))
  )
}
/** Split rich parts, Mermaid, fenced code and images; text parts stay native Markdown. */
export function splitMarkdownParts(text: string, localFiles: boolean) {
  const result: NativeMarkdownPart[] = []
  for (const rich of richMarkdown(text, localFiles)) {
    if (rich.kind !== 'markdown') {
      result.push(rich)
      continue
    }
    const appendImages = (parts: MarkdownImagePart[], offset: number) => {
      for (const image of parts)
        result.push(
          image.kind === 'text'
            ? { kind: 'markdown', text: image.text, offset: offset + image.offset }
            : { ...image, offset: offset + image.offset },
        )
    }
    if (!/(?:^|\n) {0,3}(?:`{3,}|~{3,})/.test(rich.text)) {
      appendImages(markdownImages(rich.text), rich.offset)
      continue
    }
    // One tree supplies diagrams, code and images. Keep each text fragment's own
    // definitions, matching the independently rendered Markdown boundaries.
    const diagrams = /(?:^|\n) {0,3}(?:`{3,}|~{3,})mermaid(?:\s|$)/i.test(rich.text)
    const root = fromMarkdown(rich.text)
    const references = rich.text.includes('![') && root.children.some(containsDefinition)
    let offset = 0
    let nodes: Nodes[] = []
    const appendText = (end: number) => {
      const text = rich.text.slice(offset, end)
      // A reference defined across a fence can change image/link nesting in the full
      // tree. Those fragments still parse independently, preserving their exact syntax.
      appendImages(
        references ? markdownImages(text) : markdownImagesFromNodes(text, nodes, offset),
        rich.offset + offset,
      )
    }
    for (const node of root.children) {
      const fence = completedMarkdownFence(rich.text, node)
      if (!fence) {
        nodes.push(node)
        continue
      }
      if (fence.start > offset) appendText(fence.start)
      const position = rich.offset + fence.start
      result.push(
        diagrams && fence.language?.toLowerCase() === 'mermaid'
          ? { kind: 'mermaid', text: fence.text, offset: position }
          : { kind: 'code', text: fence.text, language: fence.language, offset: position },
      )
      offset = fence.end
      nodes = []
    }
    if (offset < rich.text.length || offset === 0) appendText(rich.text.length)
  }
  return result
}
/** Shared across screens so remounted completed messages reuse their split parts. */
export const markdownParts = cachedMarkdownParts(splitMarkdownParts)
