import {
  composerModelReference,
  composerTextReferences,
  type ResourceSettings,
} from '@dovo/protocol'
import { Fragment, type Node } from 'prosemirror-model'
import { Plugin, type EditorState } from 'prosemirror-state'
import { richSchema } from './rich-markdown'

function referenceTransaction(state: EditorState, resources: ResourceSettings) {
  const matches: { start: number; end: number; kind: string; label: string }[] = []
  state.doc.descendants((block, position) => {
    if (!block.isTextblock) return true
    // Headings and code blocks deliberately accept text only.
    if (!block.type.contentMatch.matchType(richSchema.nodes.context_reference)) return false
    let run = ''
    let runStart = 0
    const flush = () => {
      for (const reference of composerTextReferences(run, resources))
        matches.push({
          ...reference,
          start: runStart + reference.start,
          end: runStart + reference.end,
        })
      run = ''
    }
    block.forEach((node, offset) => {
      const start = position + 1 + offset
      const code = node.marks.some((mark) => mark.type === richSchema.marks.code)
      const linked = node.marks.some((mark) => mark.type === richSchema.marks.link)
      if (!node.isText || code || linked) {
        flush()
        const model =
          code && !linked && node.isText ? composerModelReference(node.text ?? '') : undefined
        if (model) matches.push({ ...model, start, end: start + node.nodeSize })
        return
      }
      if (!run) runStart = start
      run += node.text
    })
    flush()
    return false
  })
  if (!matches.length) return null
  const tr = state.tr
  for (const match of matches.reverse())
    tr.replaceWith(
      match.start,
      match.end,
      richSchema.nodes.context_reference.create(
        { kind: match.kind, label: match.label },
        state.doc.slice(match.start, match.end).content,
      ),
    )
  return tr
}

/** Chips are an editing view over the existing Markdown, with no second saved draft format. */
export function contextReferences(resources: () => ResourceSettings) {
  return new Plugin({
    appendTransaction: (transactions, _before, state) =>
      transactions.some((tr) => tr.docChanged) ? referenceTransaction(state, resources()) : null,
  })
}

const expandedNodes = new WeakMap<Node, Node>()
/** Restore the original text and marks before Markdown serialization. */
export function expandReferences(node: Node, previous?: Node): Node {
  if (node.isText || !node.content.size) return node
  const cached = expandedNodes.get(node)
  if (cached && !previous) return cached
  const children: Node[] = []
  node.forEach((child) => {
    if (child.type === richSchema.nodes.context_reference)
      child.forEach((text) => children.push(text))
    else children.push(expandReferences(child))
  })
  // Reuse unchanged source blocks, including their exact delimiters and whitespace.
  if (previous)
    children.forEach((block, index) => {
      const before = previous.maybeChild(index)
      if (before?.eq(block)) children[index] = before
    })
  const expanded = node.copy(Fragment.from(children))
  const result = expanded.eq(node) ? node : expanded
  expandedNodes.set(node, result)
  return result
}

export function referenceNodeView(node: Node) {
  const dom = document.createElement('span')
  dom.className = 'dovo-composer-reference'
  dom.dataset.referenceKind = String(node.attrs.kind)
  dom.contentEditable = 'false'
  dom.title = node.textContent
  dom.setAttribute('aria-label', `${node.attrs.kind}: ${node.textContent}`)
  const kind = document.createElement('span')
  kind.className = 'dovo-composer-reference-kind'
  kind.textContent = String(node.attrs.kind === 'mcp' ? 'MCP' : node.attrs.kind)
  dom.append(kind, document.createTextNode(String(node.attrs.label)))
  return { dom }
}
