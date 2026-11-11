import {
  cachedMarkdownParts,
  richMarkdown,
  type ImmutableMarkdownParts,
  type RichMarkdownPart,
} from '@dovo/protocol'
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
/** A completed top-level fence that may become a streaming cut, in rendered part coordinates. */
type Fence = { rich: number; start: number; end: number; parts: number }
type Split = {
  parts: NativeMarkdownPart[]
  rich: RichMarkdownPart[]
  fences: Fence[]
  /** Parts produced by the first rich part. */
  first: number
}

function split(text: string, localFiles: boolean): Split {
  const result: NativeMarkdownPart[] = []
  const fences: Fence[] = []
  const rich = richMarkdown(text, localFiles)
  let first = 0
  for (const [index, part] of rich.entries()) {
    splitRichPart(part, index, result, fences)
    if (index === 0) first = result.length
  }
  return { parts: result, rich, fences, first }
}
function splitRichPart(
  rich: RichMarkdownPart,
  index: number,
  result: NativeMarkdownPart[],
  fences: Fence[],
) {
  if (rich.kind !== 'markdown') {
    result.push(rich)
    return
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
    return
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
    fences.push({ rich: index, start: fence.start, end: fence.end, parts: result.length })
    offset = fence.end
    nodes = []
  }
  if (offset < rich.text.length || offset === 0) appendText(rich.text.length)
}

/** Split rich parts, Mermaid, fenced code and images; text parts stay native Markdown. */
export function splitMarkdownParts(text: string, localFiles: boolean) {
  return split(text, localFiles).parts
}

/*
 * Streaming reuse. A completed top-level fence followed by a line ending closes every open
 * block, so the text after it parses on its own. The parts before it are final and the
 * parts after it equal the split of the remaining text, offset to the full text.
 *
 * Syntax that links blocks across the document falls back to a full split: reference and
 * footnote definitions, container directives, lone CR line endings, and Mermaid fences that
 * only become diagrams because another fence in the same part names Mermaid exactly.
 */
const documentWideSyntax =
  /\]:|:::|\r(?!\n)|^ {0,3}(?:`{3,}(?!`)|~{3,}(?!~))(?!mermaid(?:\s|$))[^\n]*(?:mermaid|&)/im

type StreamCut = {
  /** Source offset where the fence ends. */
  end: number
  /** Source offset after the fence's line ending. */
  next: number
  /** Parts up to and including the fence. */
  parts: number
  /** Part offset at the fence end; differs from `end` after rendered citations. */
  shift: number
  rich: number
}

/** Map a fence end in a rendered part back to its source, or return undefined if unsure. */
function sourceFenceEnd(source: string, rendered: string, start: number, end: number) {
  if (source === rendered) return end
  // Rendered citations change lengths but never the fence text. Match the fence by its
  // occurrence count, and only when both texts contain it equally often.
  const fence = rendered.slice(start, end)
  const occurrences = (text: string) => {
    const found: number[] = []
    for (let at = text.indexOf(fence); at !== -1; at = text.indexOf(fence, at + 1)) found.push(at)
    return found
  }
  const renderedAt = occurrences(rendered)
  const sourceAt = occurrences(source)
  const index = renderedAt.indexOf(start)
  if (index < 0 || renderedAt.length !== sourceAt.length) return
  return sourceAt[index]! + fence.length
}

function lastStreamCut(text: string, { rich, fences }: Split): StreamCut | undefined {
  for (let index = fences.length - 1; index >= 0; index--) {
    const fence = fences[index]!
    const part = rich[fence.rich]
    if (part?.kind !== 'markdown') continue
    const rendered = part.text
    const lineEnd = rendered[fence.end] === '\n' ? 1 : rendered[fence.end] === '\r' ? 2 : 0
    if (!lineEnd) continue
    const source = text.slice(part.offset, rich[fence.rich + 1]?.offset ?? text.length)
    const end = sourceFenceEnd(source, rendered, fence.start, fence.end)
    if (end === undefined) continue
    const eol = rendered.slice(fence.end, fence.end + lineEnd)
    if (source.slice(end, end + lineEnd) !== eol || (lineEnd === 2 && eol !== '\r\n')) continue
    return {
      end: part.offset + end,
      next: part.offset + end + lineEnd,
      parts: fence.parts,
      shift: part.offset + fence.end,
      rich: fence.rich,
    }
  }
}

type StreamAnchor = {
  /** Source through the cut's line ending; later text must start with it. */
  prefix: string
  localFiles: boolean
  /** Final parts before the cut. */
  parts: readonly NativeMarkdownPart[]
  end: number
  shift: number
}
// A few concurrently streaming messages; prefixes are dropped once their message completes.
const anchorLimit = 4
const anchorCharacters = 1_000_000
const anchors: StreamAnchor[] = []
function removeAnchor(anchor: StreamAnchor) {
  const index = anchors.indexOf(anchor)
  if (index >= 0) anchors.splice(index, 1)
}
function storeAnchor(anchor: StreamAnchor) {
  if (anchor.prefix.length > anchorCharacters) return
  anchors.push(anchor)
  let characters = anchors.reduce((sum, { prefix }) => sum + prefix.length, 0)
  while (anchors.length > anchorLimit || characters > anchorCharacters)
    characters -= anchors.shift()!.prefix.length
}

/** Split only the text after the last reusable cut; `keep` retains a new cut for the next update. */
function splitIncrementally(text: string, localFiles: boolean, keep: boolean) {
  let anchor: StreamAnchor | undefined
  for (const candidate of anchors)
    if (
      candidate.localFiles === localFiles &&
      candidate.prefix.length > (anchor?.prefix.length ?? 0) &&
      text.startsWith(candidate.prefix)
    )
      anchor = candidate
  if (anchor) removeAnchor(anchor)
  const start = anchor?.end ?? 0
  const tail = anchor ? text.slice(start) : text
  // Text before the anchor passed this check when its cut was stored.
  if (anchor && documentWideSyntax.test(tail)) return splitMarkdownParts(text, localFiles)
  const next = split(tail, localFiles)
  let parts = next.parts
  if (anchor) {
    parts = [...anchor.parts]
    // The first tail part continues the rendered part that held the cut.
    for (const [index, part] of next.parts.entries())
      parts.push({ ...part, offset: part.offset + (index < next.first ? anchor.shift : start) })
  }
  if (!keep) return parts
  const cut = lastStreamCut(tail, next)
  if (cut && (anchor || !documentWideSyntax.test(text)))
    storeAnchor({
      prefix: text.slice(0, start + cut.next),
      localFiles,
      parts: parts.slice(0, (anchor?.parts.length ?? 0) + cut.parts),
      end: start + cut.end,
      shift: (anchor && cut.rich === 0 ? anchor.shift : start) + cut.shift,
    })
  else if (anchor) storeAnchor(anchor)
  return parts
}

// Completed text may finish from a streaming cut once; its anchor is then released.
const completedMarkdownParts = cachedMarkdownParts((text: string, localFiles: boolean) =>
  splitIncrementally(text, localFiles, false),
)
/**
 * Shared across screens so remounted completed messages reuse their split parts. Streaming
 * prefixes split only the text after their last completed top-level fence.
 */
export function markdownParts(
  text: string,
  localFiles: boolean,
  streaming = false,
): ImmutableMarkdownParts<NativeMarkdownPart> {
  return streaming
    ? splitIncrementally(text, localFiles, true)
    : completedMarkdownParts(text, localFiles)
}
