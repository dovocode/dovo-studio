import { DOMParser, onErrorStopParsing, type Element, type Node } from '@xmldom/xmldom'
import { posix } from 'node:path'
import { attachmentDocumentKind, ATTACHMENT_PREVIEW_CHARS } from '@dovo/protocol'
import { openBoundedZip, readZipEntry } from './attachment-archive.js'
import type { Attachments } from './attachments.js'

const maxPartBytes = 1024 * 1024
const maxBookBytes = 4 * maxPartBytes
const wordNamespaces = new Set([
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main',
])
const bookBlocks = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'caption',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'li',
  'p',
  'pre',
  'section',
  'table',
  'tr',
  'ul',
  'ol',
])
const hiddenBookTags = new Set(['head', 'script', 'style', 'template', 'noscript', 'rt'])

function* walk(
  root: Element,
  skip: (element: Element) => boolean,
): Generator<{ element: Element; closing: boolean } | { text: string }, void> {
  const stack: { node: Node; closing: boolean }[] = [{ node: root, closing: false }]
  while (stack.length) {
    const { node, closing } = stack.pop()!
    if (node.nodeType === 1) {
      const element = node as Element
      if (!closing && skip(element)) continue
      yield { element, closing }
      if (closing) continue
      stack.push({ node, closing: true })
      for (let child = node.lastChild; child; child = child.previousSibling)
        stack.push({ node: child, closing: false })
    } else if ((node.nodeType === 3 || node.nodeType === 4) && node.nodeValue) {
      yield { text: node.nodeValue }
    }
  }
}

function* wordText(root: Element) {
  if (!root.namespaceURI || !wordNamespaces.has(root.namespaceURI)) return
  let inText = false
  for (const entry of walk(root, (element) => element.namespaceURI !== root.namespaceURI)) {
    if ('text' in entry) {
      if (inText) yield entry.text
      continue
    }
    const tag = entry.element.localName
    if (tag === 't') inText = !entry.closing
    if (!entry.closing && (tag === 'br' || tag === 'cr')) yield '\n'
    if (!entry.closing && tag === 'tab') yield '\t'
    if (tag === 'p' || tag === 'tr') yield '\n'
  }
}

function* bookText(root: Element) {
  for (const entry of walk(
    root,
    (element) =>
      hiddenBookTags.has(element.localName ?? '') ||
      element.hasAttribute('hidden') ||
      element.getAttribute('aria-hidden') === 'true' ||
      /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i.test(
        element.getAttribute('style') ?? '',
      ),
  )) {
    if ('text' in entry) {
      yield entry.text.replace(/\s+/gu, ' ')
      continue
    }
    const { element, closing } = entry
    const tag = element.localName ?? ''
    if (!closing && tag === 'img') yield element.getAttribute('alt') ?? ''
    if (bookBlocks.has(tag) || (!closing && (tag === 'br' || tag === 'hr'))) yield '\n'
    if (closing && (tag === 'td' || tag === 'th')) yield '\t'
  }
}

function* elements(root: Element, name: string) {
  for (const entry of walk(root, () => false))
    if ('element' in entry && !entry.closing && entry.element.localName === name)
      yield entry.element
}

function bookPartPath(manifestPath: string, href: string) {
  const origin = 'https://epub.invalid'
  const base = `${origin}/${manifestPath.split('/').map(encodeURIComponent).join('/')}`
  const url = new URL(href, base)
  if (url.origin !== origin) return
  const path = decodeURIComponent(url.pathname.slice(1))
  if (posix.normalize(path) === path) return path
}

export async function attachmentDocumentPreview(source: ReturnType<Attachments['read']>) {
  const format = attachmentDocumentKind(source.attachment.name)
  if (!format) return
  try {
    const entries = await openBoundedZip(Buffer.from(source.data, 'base64'))
    const files = new Map(entries.filter((entry) => entry.type === 'File').map((e) => [e.path, e]))
    let bytesLeft = maxBookBytes
    const xml = async (path: string) => {
      const entry = files.get(path)
      if (!entry) return null
      const bytes = await readZipEntry(entry, Math.min(maxPartBytes, bytesLeft))
      bytesLeft -= bytes.length
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      return new DOMParser({ onError: onErrorStopParsing, locator: false }).parseFromString(
        text,
        'application/xml',
      ).documentElement
    }
    let raw = ''
    const append = (chunks: Iterable<string>) => {
      for (const chunk of chunks) {
        raw += chunk
        if (raw.length > ATTACHMENT_PREVIEW_CHARS) break
      }
    }
    if (format === 'docx') {
      const root = await xml('word/document.xml')
      if (!root || root.localName !== 'document') return
      append(wordText(root))
    } else {
      const container = await xml('META-INF/container.xml')
      if (!container) return
      const manifestPath = elements(container, 'rootfile').next().value?.getAttribute('full-path')
      if (!manifestPath) return
      const manifest = await xml(manifestPath)
      if (!manifest || manifest.localName !== 'package') return
      const parts = new Map<string, string>()
      for (const item of elements(manifest, 'item')) {
        const id = item.getAttribute('id')
        const href = item.getAttribute('href')
        if (id && href && item.getAttribute('media-type') === 'application/xhtml+xml') {
          const path = bookPartPath(manifestPath, href)
          if (path) parts.set(id, path)
        }
      }
      for (const item of elements(manifest, 'itemref')) {
        const path = parts.get(item.getAttribute('idref') ?? '')
        if (!path) continue
        const chapter = await xml(path)
        if (!chapter) continue
        append(bookText(chapter))
        raw += '\n\n'
        if (raw.length > ATTACHMENT_PREVIEW_CHARS) break
      }
    }
    const text = raw
      .slice(0, ATTACHMENT_PREVIEW_CHARS)
      .replace(/[\uD800-\uDBFF]$/u, '')
      .replace(/[ \t]*\n[ \t]*/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    if (text) return raw.length > ATTACHMENT_PREVIEW_CHARS ? `${text}\n… Preview truncated` : text
  } catch {
    // Invalid or oversized containers still have their normal download and share actions.
    return undefined
  }
}
