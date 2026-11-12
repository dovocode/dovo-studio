import MarkdownIt from 'markdown-it'
import {
  MarkdownParser,
  MarkdownSerializer,
  defaultMarkdownParser,
  defaultMarkdownSerializer,
  schema as markdownSchema,
  type MarkdownSerializerState,
} from 'prosemirror-markdown'
import { Schema, type Node } from 'prosemirror-model'

/**
 * Rich composer documents: CommonMark plus GFM strikethrough, without images.
 * Images, tables and anything else outside this schema keep the draft in Markdown source.
 */
export const richSchema = new Schema({
  nodes: markdownSchema.spec.nodes
    .remove('image')
    .addBefore('text', 'context_reference', {
      inline: true,
      group: 'inline',
      content: 'text*',
      atom: true,
      attrs: { kind: {}, label: {}, provider: { default: null } },
      // The clipboard HTML contains the full reference. Only the live node view shortens it.
      toDOM: () => ['span', 0],
    })
    .update('heading', { ...markdownSchema.spec.nodes.get('heading')!, content: 'text*' })
    // Chat lists are tight and keep the bullet they were written with.
    .update('bullet_list', {
      ...markdownSchema.spec.nodes.get('bullet_list')!,
      attrs: { tight: { default: true }, bullet: { default: '-' } },
    })
    .update('ordered_list', {
      ...markdownSchema.spec.nodes.get('ordered_list')!,
      attrs: { order: { default: 1 }, tight: { default: true } },
    }),
  marks: markdownSchema.spec.marks.addToEnd('strike', {
    parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }],
    toDOM: () => ['s', 0],
  }),
})

// Tables are tokenized only so that the parser rejects them instead of flattening them.
const tokenizer = MarkdownIt('commonmark', { html: false }).enable(['strikethrough', 'table'])
// A file reference is literal source. Do not interpret __tests__ or other path punctuation
// as Markdown marks before the reference plugin turns the completed token into a chip.
tokenizer.inline.ruler.before('text', 'composer_file_reference', (state, silent) => {
  const match = /^([^\\\n`*_[\]<>!~]*\s)?(@[^\s@]+)(?=\s)/.exec(
    state.src.slice(state.pos, state.posMax),
  )
  if (!match || !/[\\/]|\.[\w-]+$/.test(match[2].slice(1))) return false
  if (!match[1] && state.pos > 0 && !/\s/.test(state.src[state.pos - 1])) return false
  if (!silent) state.pending += match[0]
  state.pos += match[0].length
  return true
})
const { image: _image, ...tokens } = defaultMarkdownParser.tokens
type Token = ReturnType<typeof tokenizer.parse>[number]
const tight = (list: readonly Token[], index: number) => {
  for (let at = index + 1; at < list.length; at++)
    if (list[at].type !== 'list_item_open') return list[at].hidden
  return false
}
const parser = new MarkdownParser(richSchema, tokenizer, {
  ...tokens,
  bullet_list: {
    block: 'bullet_list',
    getAttrs: (token, list, index) => ({ tight: tight(list, index), bullet: token.markup }),
  },
  ordered_list: {
    block: 'ordered_list',
    getAttrs: (token, list, index) => ({
      order: Number(token.attrGet('start')) || 1,
      tight: tight(list, index),
    }),
  },
  s: { mark: 'strike' },
  // A single newline is a line break in chat; keep it as one.
  softbreak: { node: 'hard_break' },
})

const strike = { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true }
type BreakStyle = 'newline' | 'backslash'
/**
 * How text is escaped: `none` writes it literally, `default` uses prosemirror-markdown's
 * escaping, and a set escapes exactly those ASCII punctuation marks, numbered in order.
 */
type EscapeStyle = 'none' | 'default' | ReadonlySet<number>
const punctuation = /[!-/:-@[-`{-~]/g
function serialize(doc: Node, escape: EscapeStyle, breaks: BreakStyle) {
  let mark = 0
  return new MarkdownSerializer(
    {
      ...defaultMarkdownSerializer.nodes,
      hard_break(state: MarkdownSerializerState, node: Node, parent: Node, index: number) {
        for (let i = index + 1; i < parent.childCount; i++)
          if (parent.child(i).type !== node.type) {
            state.write(breaks === 'newline' ? '\n' : '\\\n')
            return
          }
      },
      text(state: MarkdownSerializerState, node: Node) {
        const text = node.text ?? ''
        // Autolinks are written verbatim; `inAutolink` is set by the link mark serializer.
        const autolink = (state as unknown as { inAutolink?: boolean }).inAutolink
        if (autolink || escape === 'none') state.text(text, false)
        else if (escape === 'default') state.text(text)
        else
          state.text(
            text.replace(punctuation, (character) =>
              escape.has(mark++) ? `\\${character}` : character,
            ),
            false,
          )
      },
    },
    { ...defaultMarkdownSerializer.marks, strike },
  ).serialize(doc)
}
const reads = (text: string, doc: Node) => {
  try {
    return parser.parse(text).eq(doc)
  } catch {
    return false
  }
}
// Removing escapes one at a time costs a parse each; long punctuation-heavy blocks keep all.
const minimalEscapeLimit = 32

/** Parsed blocks keep their exact source so untouched text is never rewritten. */
export type RichMarkdown = {
  readonly doc: Node
  readonly blocks: readonly Node[]
  readonly pieces: readonly string[]
  readonly separators: readonly string[]
  readonly prefix: string
  readonly suffix: string
  readonly text: string
}

export type RichMarkdownResult =
  | { readonly supported: true; readonly value: RichMarkdown }
  | { readonly supported: false; readonly reason: string }

const lineOffsets = (text: string) => {
  const offsets = [0]
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1))
    offsets.push(index + 1)
  return offsets
}

// The composer checks support on every draft change; the rich editor primes its own output.
let recent: { text: string; result: RichMarkdownResult } | undefined
/** Record a serialization so the support check for the same text does not parse it again. */
export function rememberRichMarkdown(value: RichMarkdown) {
  recent = { text: value.text, result: { supported: true, value } }
}

/** Parse a draft for rich editing, or explain why it must stay in Markdown source. */
export function parseRichMarkdown(text: string): RichMarkdownResult {
  if (recent?.text === text) return recent.result
  const result = parseUncached(text)
  recent = { text, result }
  return result
}

function parseUncached(text: string): RichMarkdownResult {
  if (text.includes('\r'))
    return { supported: false, reason: 'This draft uses Windows line endings.' }
  let doc: Node
  try {
    doc = parser.parse(text)
  } catch {
    return {
      supported: false,
      reason: 'This draft uses Markdown the rich editor cannot show, such as a table or image.',
    }
  }
  const top = tokenizer
    .parse(text, {})
    .filter((token) => token.level === 0 && token.nesting !== -1 && token.map)
  const blocks: Node[] = []
  doc.forEach((child) => blocks.push(child))
  const unsupported = {
    supported: false as const,
    reason: 'This draft uses Markdown the rich editor cannot preserve, such as link definitions.',
  }
  if (!text.trim()) return { supported: true, value: fromBlocks(doc, [], [], [], '', '', text) }
  if (top.length !== blocks.length) return unsupported
  const offsets = lineOffsets(text)
  const at = (line: number) => (line < offsets.length ? offsets[line] : text.length)
  const ranges = top.map((token) => {
    const [start, end] = token.map!
    return [at(start), at(end)] as const
  })
  for (let index = 1; index < ranges.length; index++)
    if (ranges[index][0] < ranges[index - 1][1]) return unsupported
  const pieces = ranges.map(([start, end]) => text.slice(start, end).replace(/\n+$/, ''))
  const gap = (from: number, to: number) => text.slice(from, to)
  const prefix = gap(0, ranges[0][0])
  const separators = ranges
    .slice(1)
    .map(([start], index) => gap(ranges[index][0] + pieces[index].length, start))
  const last = ranges.length - 1
  const suffix = gap(ranges[last][0] + pieces[last].length, text.length)
  // Text outside blocks, such as link reference definitions, cannot survive a re-serialization.
  if ([prefix, suffix, ...separators].some((part) => part.trim())) return unsupported
  return {
    supported: true,
    value: fromBlocks(doc, blocks, pieces, separators, prefix, suffix, text),
  }
}

function fromBlocks(
  doc: Node,
  blocks: Node[],
  pieces: string[],
  separators: string[],
  prefix: string,
  suffix: string,
  text: string,
): RichMarkdown {
  return { doc, blocks, pieces, separators, prefix, suffix, text }
}

/**
 * Serialize one block with the least escaping that still parses back to the same block, so
 * paths and code-like prose stay byte-for-byte when that cannot change what they mean.
 */
export function serializeBlock(block: Node) {
  const doc = richSchema.topNodeType.create(null, block)
  for (const escape of ['none', 'default'] as const) {
    const text = serialize(doc, escape, 'newline')
    if (reads(text, doc)) return text
  }
  const count = doc.textContent.match(punctuation)?.length ?? 0
  const all = new Set(Array.from({ length: count }, (_, index) => index))
  // Whitespace at mark edges moves outside the markers; keep the meaning that survives.
  const safest = serialize(doc, all, 'backslash')
  const target = reads(safest, doc) ? doc : parser.parse(safest)
  const breaks: BreakStyle = reads(serialize(doc, all, 'newline'), target) ? 'newline' : 'backslash'
  if (count > minimalEscapeLimit) return serialize(doc, all, breaks)
  const escaped = new Set(all)
  for (const index of all) {
    escaped.delete(index)
    if (!reads(serialize(doc, escaped, breaks), target)) escaped.add(index)
  }
  return serialize(doc, escaped, breaks)
}

/**
 * Serialize an edited document. Blocks that are unchanged since `previous` keep their exact
 * source, including the blank lines between unchanged neighbours.
 */
export function serializeRichMarkdown(doc: Node, previous: RichMarkdown): RichMarkdown {
  if (doc === previous.doc) return previous
  const before = new Map<Node, number>()
  previous.blocks.forEach((block, index) => before.set(block, index))
  const blocks: Node[] = []
  doc.forEach((child) => blocks.push(child))
  // An empty document is one empty paragraph.
  if (blocks.length === 1 && blocks[0].type.name === 'paragraph' && !blocks[0].content.size)
    return fromBlocks(doc, [], [], [], '', '', '')
  const origins = blocks.map((block) => before.get(block))
  const pieces = blocks.map((block, index) =>
    origins[index] === undefined ? serializeBlock(block) : previous.pieces[origins[index]!],
  )
  const separators = blocks.slice(1).map((_, index) => {
    const left = origins[index]
    const right = origins[index + 1]
    return left !== undefined && right === left + 1 ? previous.separators[left] : '\n\n'
  })
  const prefix = origins[0] === 0 ? previous.prefix : ''
  const suffix =
    origins.length && origins[origins.length - 1] === previous.blocks.length - 1
      ? previous.suffix
      : ''
  let text = prefix
  pieces.forEach((piece, index) => {
    text += (index ? separators[index - 1] : '') + piece
  })
  text += suffix
  return fromBlocks(doc, blocks, pieces, separators, prefix, suffix, text)
}

/** The document for a draft that is known to be supported. */
export const emptyRichDocument = () => richSchema.topNodeType.createAndFill()!

const visibleText = (doc: Node, to = doc.content.size) => doc.textBetween(0, to, '\n', '\n')

/** Where each visible character of `doc` sits in its Markdown source. */
function sourceIndexes(doc: Node, markdown: string) {
  const visible = visibleText(doc)
  const indexes: number[] = []
  let cursor = 0
  for (let index = 0; index < visible.length; index++) {
    const character = visible[index]
    const found = markdown.indexOf(character, cursor)
    if (found === -1) break
    indexes.push(found)
    cursor = found + 1
  }
  return { visible, indexes }
}

/** The Markdown source offset of a rich-editor position, for switching modes and dictation. */
export function sourceOffsetAt(doc: Node, markdown: string, position: number) {
  const { visible, indexes } = sourceIndexes(doc, markdown)
  const count = Math.min(visibleText(doc, position).length, indexes.length)
  // At the start of a block, land before its first character, after any heading or list marker.
  if (count < indexes.length && (count === 0 || visible[count - 1] === '\n')) return indexes[count]
  return count ? indexes[count - 1] + 1 : 0
}

/** The rich-editor position for a Markdown source offset. */
export function positionAtSourceOffset(doc: Node, markdown: string, offset: number) {
  const { indexes } = sourceIndexes(doc, markdown)
  let count = 0
  while (count < indexes.length && indexes[count] < offset) count++
  let low = 0
  let high = doc.content.size
  while (low < high) {
    const middle = (low + high) >> 1
    if (visibleText(doc, middle).length < count) low = middle + 1
    else high = middle
  }
  // Inline atoms expose their source text but have no editable caret positions inside.
  doc.descendants((node, position) => {
    if (!node.isInline || !node.isAtom || node.isText) return true
    const end = position + node.nodeSize
    if (low > position && low < end) {
      const startOffset = sourceOffsetAt(doc, markdown, position)
      const endOffset = sourceOffsetAt(doc, markdown, end)
      low = offset - startOffset < endOffset - offset ? position : end
    }
    return false
  })
  return low
}
