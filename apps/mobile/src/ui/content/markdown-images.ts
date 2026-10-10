import { fromMarkdown } from 'mdast-util-from-markdown'
import type { Nodes } from 'mdast'
export type MarkdownImagePart =
  | { kind: 'text'; text: string; offset: number }
  | { kind: 'image'; url: string; alt: string; offset: number }
/** Parse Markdown images (including references) without interpreting fenced/escaped text. */
export function markdownImages(text: string): MarkdownImagePart[] {
  const root = fromMarkdown(text),
    definitions = new Map(
      root.children.flatMap((node) =>
        node.type === 'definition' ? [[node.identifier, node.url] as const] : [],
      ),
    )
  const images: Array<{ start: number; end: number; url: string; alt: string }> = []
  const visit = (node: Nodes, parent?: Nodes) => {
    if (node.type === 'image' || node.type === 'imageReference') {
      const url = node.type === 'image' ? node.url : definitions.get(node.identifier),
        position =
          parent?.type === 'link' && parent.children.length === 1 ? parent.position : node.position,
        start = position?.start.offset,
        end = position?.end.offset
      if (url && start !== undefined && end !== undefined)
        images.push({ start, end, url, alt: node.alt ?? 'Image' })
    }
    if ('children' in node) for (const child of node.children) visit(child, node)
  }
  visit(root)
  const parts: MarkdownImagePart[] = []
  let offset = 0
  for (const image of images) {
    if (image.start > offset)
      parts.push({ kind: 'text', text: text.slice(offset, image.start), offset })
    parts.push({ kind: 'image', url: image.url, alt: image.alt, offset: image.start })
    offset = image.end
  }
  if (offset < text.length || !parts.length)
    parts.push({ kind: 'text', text: text.slice(offset), offset })
  return parts
}
