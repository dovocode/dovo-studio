import { fromMarkdown } from 'mdast-util-from-markdown'
import { directiveFromMarkdown } from 'mdast-util-directive'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import { directive } from 'micromark-extension-directive'
import type { Nodes } from 'mdast'
import { Schema } from 'effect'
import { decodeResult, mutableStruct, maxValue, minValue } from '../../shared/schema.js'
import { localMarkdownPath } from './markdown-links.js'

export type ArtifactTemplate = {
  kind: string
  name: string
  skill: string
  directory: string
}
export type RichMarkdownPart =
  | { kind: 'markdown'; text: string; offset: number }
  | { kind: 'file'; path: string; label: string; offset: number }
  | { kind: 'image'; path: string; label: string; offset: number }
  | { kind: 'video'; path: string; label: string; offset: number }
  | { kind: 'visualization'; path: string; label: string; wide: boolean; offset: number }
  | { kind: 'template'; template: ArtifactTemplate; offset: number }
const visualizationSchema = mutableStruct({
  path: maxValue(minValue(Schema.String, 1), 4000),
  title: Schema.optional(maxValue(minValue(Schema.String, 1), 200)),
  mode: Schema.optional(Schema.Literals(['wide'])),
})
function visualization(value: string) {
  try {
    const parsed = decodeResult(visualizationSchema, JSON.parse(value)).data
    if (!parsed || localMarkdownPath(parsed.path) === undefined || !/\.html?$/i.test(parsed.path))
      return
    return parsed
  } catch {
    // Incomplete streaming markers stay literal until their JSON is complete.
    return
  }
}
const templateKinds = new Set([
  'document',
  'presentation',
  'spreadsheet',
  'site',
  'google-docs',
  'google-slides',
  'google-sheets',
  'image',
  'email',
  'slack',
])
export function markdownFileName(path: string) {
  let decoded = path.replace(/[?#].*$/, '').replace(/:\d+(?::\d+)?$/, '')
  try {
    decoded = decodeURIComponent(decoded)
  } catch {
    /* Keep malformed escapes readable. */
  }
  return decoded.replaceAll('\\', '/').split('/').at(-1) || 'File'
}
export function markdownMediaKind(path: string): 'image' | 'video' | undefined {
  if (localMarkdownPath(path) === undefined && !/^https?:\/\//i.test(path)) return undefined
  const name = markdownFileName(path)
  if (/\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i.test(name)) return 'image'
  if (/\.(mp4|webm|mov|m4v|ogv)$/i.test(name)) return 'video'
  return undefined
}
export function artifactTemplatePrompt(template: ArtifactTemplate) {
  return `Use $${template.skill} to create a ${template.kind.replaceAll('-', ' ')} about…`
}
function parse(text: string) {
  return fromMarkdown(text, {
    extensions: [gfm(), directive()],
    mdastExtensions: [gfmFromMarkdown(), directiveFromMarkdown()],
  })
}
function citation(node: Nodes): string | undefined {
  if (node.type !== 'textDirective' || node.name !== 'codex-file-citation') return
  const path = node.attributes?.path?.trim()
  if (!path || localMarkdownPath(path) === undefined) return
  const start = Number(node.attributes?.line_range_start)
  const end = Number(node.attributes?.line_range_end)
  const lines =
    Number.isSafeInteger(start) && start > 0
      ? `:${start}${Number.isSafeInteger(end) && end >= start ? `–${end}` : ''}`
      : ''
  const href = path
    .replaceAll('%', '%25')
    .replaceAll('#', '%23')
    .replaceAll('?', '%3F')
    .replaceAll('\\', '%5C')
    .replaceAll('<', '%3C')
    .replaceAll('>', '%3E')
    .replaceAll('\n', '%0A')
    .replaceAll('\r', '%0D')
  const label = `${path.replaceAll('\\', '/').split('/').at(-1)}${lines}`.replace(
    /[\\[\]*_`<&]/g,
    '\\$&',
  )
  return `[${label}](<${href}${lines ? `#L${start}` : ''}>)`
}
/** Convert only valid citations outside code/links. Unknown or incomplete directives stay literal. */
export function renderFileCitations(text: string) {
  if (!text.includes(':codex-file-citation')) return text
  const edits: Array<{ start: number; end: number; text: string }> = []
  const visit = (node: Nodes, inLink = false) => {
    const rendered = inLink ? undefined : citation(node)
    if (
      rendered &&
      node.position?.start.offset !== undefined &&
      node.position.end.offset !== undefined
    )
      edits.push({
        start: node.position.start.offset,
        end: node.position.end.offset,
        text: rendered,
      })
    if ('children' in node)
      for (const child of node.children)
        visit(child, inLink || node.type === 'link' || node.type === 'linkReference')
  }
  visit(parse(text))
  for (const edit of edits.reverse())
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end)
  return text
}
export function richMarkdown(text: string, localFiles = true): RichMarkdownPart[] {
  if (
    !text.includes('[') &&
    !/https?:\/\//i.test(text) &&
    !text.includes(':codex-file-citation') &&
    !text.includes('::artifact-template') &&
    !text.includes('\uE200visualize\uE202')
  )
    return [{ kind: 'markdown', text, offset: 0 }]
  const root = parse(text)
  const definitions = new Map(
    root.children.flatMap((node) =>
      node.type === 'definition' ? [[node.identifier, node.url] as const] : [],
    ),
  )
  const parts: RichMarkdownPart[] = []
  let offset = 0
  const edits: Array<{ start: number; end: number; part: RichMarkdownPart }> = []
  const add = (start: number, end: number, part: RichMarkdownPart) =>
    edits.push({ start, end, part })
  for (const node of root.children) {
    const start = node.position?.start.offset,
      end = node.position?.end.offset
    if (start === undefined || end === undefined) continue
    if (node.type === 'leafDirective' && node.name === 'artifact-template') {
      const a = node.attributes
      const kind = a?.artifact_kind,
        name = a?.display_name?.trim(),
        skill = a?.skill_name,
        directory = a?.skill_directory
      if (
        !kind ||
        !templateKinds.has(kind) ||
        !name ||
        !skill ||
        !/^artifact-template-[\w-]+$/.test(skill) ||
        !directory ||
        !/^(?:\/[^/]|[A-Za-z]:[\\/]|\\\\)/.test(directory)
      )
        continue
      add(start, end, {
        kind: 'template',
        offset: start,
        template: { kind, name, skill, directory },
      })
      continue
    }
    if (node.type !== 'paragraph') continue
    if (localFiles) {
      const source = text.slice(start, end)
      for (const match of source.matchAll(
        /(?:^|\n)[ \t]*\uE200visualize\uE202([^\n]+?)\uE201[ \t]*(?=\n|$)/g,
      )) {
        const parsed = visualization(match[1]!)
        if (!parsed) continue
        const from = start + match.index + (match[0].startsWith('\n') ? 1 : 0)
        if (
          node.children.some(
            (child) =>
              child.type === 'inlineCode' &&
              (child.position?.start.offset ?? Infinity) <= from &&
              (child.position?.end.offset ?? -1) > from,
          )
        )
          continue
        add(from, start + match.index + match[0].length, {
          kind: 'visualization',
          path: parsed.path,
          label: parsed.title ?? markdownFileName(parsed.path),
          wide: parsed.mode === 'wide',
          offset: from,
        })
      }
    }
    for (const child of node.children) {
      if (child.type !== 'link' && child.type !== 'linkReference') continue
      const from = child.position?.start.offset,
        to = child.position?.end.offset
      if (from === undefined || to === undefined) continue
      // Own line at the top level; prose, lists, quotes and code keep normal links.
      const before = text.slice(text.lastIndexOf('\n', from - 1) + 1, from)
      const next = text.indexOf('\n', to)
      const after = text.slice(to, next === -1 ? text.length : next)
      if (before.trim() || after.trim()) continue
      const path = child.type === 'link' ? child.url : definitions.get(child.identifier)
      if (!path || (!localFiles && localMarkdownPath(path) !== undefined)) continue
      const kind =
        markdownMediaKind(path) ?? (localMarkdownPath(path) !== undefined ? 'file' : undefined)
      if (!kind) continue
      const label =
        child.children.map((value) => ('value' in value ? value.value : '')).join('') ||
        markdownFileName(path)
      add(from, to, { kind, path, label, offset: from })
    }
  }
  for (const edit of edits.sort((a, b) => a.start - b.start)) {
    if (edit.start < offset) continue
    if (edit.start > offset)
      parts.push({
        kind: 'markdown',
        text: renderFileCitations(text.slice(offset, edit.start)),
        offset,
      })
    parts.push(edit.part)
    offset = edit.end
  }
  if (offset < text.length || !parts.length)
    parts.push({ kind: 'markdown', text: renderFileCitations(text.slice(offset)), offset })
  // Each independently rendered block needs the original reference definitions.
  if (parts.length > 1 && definitions.size) {
    const source = root.children
      .filter((node) => node.type === 'definition')
      .map((node) => text.slice(node.position?.start.offset, node.position?.end.offset))
      .join('\n')
    for (const part of parts) if (part.kind === 'markdown') part.text += `\n\n${source}`
  }
  return parts
}
/** Paths explicitly shared by assistant output, including structured file citations. */
export function richMarkdownPaths(text: string): string[] {
  const visualizations = richMarkdown(text).flatMap((part) =>
    part.kind === 'visualization' ? [part.path] : [],
  )
  if (!text.includes(':codex-file-citation')) return visualizations
  const paths: string[] = [...visualizations]
  const visit = (node: Nodes, inLink = false) => {
    if (!inLink && node.type === 'textDirective' && citation(node) && node.attributes?.path)
      paths.push(node.attributes.path)
    if ('children' in node)
      for (const child of node.children)
        visit(child, inLink || node.type === 'link' || node.type === 'linkReference')
  }
  visit(parse(text))
  return paths
}
