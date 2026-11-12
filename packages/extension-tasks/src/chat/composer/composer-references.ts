import {
  composerModelReference,
  composerTextReferences,
  harnessIconData,
  providerSchema,
  composerReferenceIcon,
  composerIconMasks,
  type ComposerReference,
  type ComposerReferenceResources,
} from '@dovo/protocol'
import { Fragment, type Node } from 'prosemirror-model'
import { Plugin, type EditorState } from 'prosemirror-state'
import { richSchema } from './rich-markdown'

function referenceTransaction(state: EditorState, resources: ComposerReferenceResources) {
  const matches: ComposerReference[] = []
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
          code && !linked && node.isText
            ? composerModelReference(node.text ?? '', resources.agents)
            : undefined
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
        { kind: match.kind, label: match.label, provider: match.provider ?? null },
        state.doc.slice(match.start, match.end).content,
      ),
    )
  return tr
}

/** Chips are an editing view over the existing Markdown, with no second saved draft format. */
export function contextReferences(resources: () => ComposerReferenceResources) {
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
  const provider = providerSchema.literals.find((provider) => provider === node.attrs.provider)
  if (node.attrs.kind === 'model' && provider) {
    const data = harnessIconData[provider]
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    icon.classList.add('dovo-composer-reference-icon')
    icon.dataset.harness = provider
    icon.setAttribute('viewBox', data.viewBox)
    icon.setAttribute('fill', data.fill ?? 'currentColor')
    icon.setAttribute('aria-hidden', 'true')
    for (const path of data.paths) {
      const element = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      element.setAttribute('d', path.d)
      if (path.opacity !== undefined) element.setAttribute('opacity', String(path.opacity))
      icon.append(element)
    }
    dom.append(icon)
  }
  if (!provider) {
    const kind = node.attrs.kind
    if (kind === 'file' || kind === 'skill' || kind === 'mcp' || kind === 'model') {
      const key = composerReferenceIcon({ kind, label: String(node.attrs.label) })
      const icon = document.createElement('span')
      icon.className = 'dovo-composer-reference-icon'
      icon.dataset.referenceIcon = key
      icon.setAttribute('aria-hidden', 'true')
      icon.style.maskImage = `url("${composerIconMasks[key]}")`
      icon.style.maskSize = 'contain'
      icon.style.maskRepeat = 'no-repeat'
      icon.style.backgroundColor = 'currentColor'
      dom.append(icon)
    }
  }
  dom.append(document.createTextNode(String(node.attrs.label)))
  return { dom }
}
