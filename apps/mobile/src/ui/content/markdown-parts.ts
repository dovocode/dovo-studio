import { cachedMarkdownParts, richMarkdown, type RichMarkdownPart } from '@dovo/protocol'
import { markdownImages, type MarkdownImagePart } from './markdown-images'
import { markdownCodeBlocks, type MarkdownCodePart } from './markdown-code-blocks'
import { mermaidBlocks, type MarkdownPart } from './mermaid-blocks'

export type NativeMarkdownPart =
  | Exclude<RichMarkdownPart, { kind: 'markdown' }>
  | MarkdownPart
  | MarkdownCodePart
  | Extract<MarkdownImagePart, { kind: 'image' }>
/** Split rich parts, Mermaid, fenced code and images; text parts stay native Markdown. */
export function splitMarkdownParts(text: string, localFiles: boolean) {
  const result: NativeMarkdownPart[] = []
  for (const rich of richMarkdown(text, localFiles)) {
    if (rich.kind !== 'markdown') {
      result.push(rich)
      continue
    }
    for (const part of mermaidBlocks(rich.text)) {
      if (part.kind === 'mermaid') {
        result.push({ ...part, offset: rich.offset + part.offset })
        continue
      }
      for (const block of markdownCodeBlocks(part.text)) {
        const offset = rich.offset + part.offset + block.offset
        if (block.kind === 'code') {
          result.push({ ...block, offset })
          continue
        }
        for (const image of markdownImages(block.text)) {
          result.push(
            image.kind === 'text'
              ? { kind: 'markdown', text: image.text, offset: offset + image.offset }
              : { ...image, offset: offset + image.offset },
          )
        }
      }
    }
  }
  return result
}
/** Shared across screens so remounted completed messages reuse their split parts. */
export const markdownParts = cachedMarkdownParts(splitMarkdownParts)
