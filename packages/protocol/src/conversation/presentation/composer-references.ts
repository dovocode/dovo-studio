import { explicitFileMentions, maskFileMentions } from './file-mentions.js'
import { parseStudioReference } from '../../runtime/studio-reference.js'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { providerSchema, type Agent, type TaskHarness } from '../../workspace.js'
import { fileIconKind } from '../../scm/repositories/file-tree.js'

export type ComposerReferenceResources = {
  skills: readonly { name: string }[]
  mcpServers: readonly { name: string; enabled: boolean }[]
  agents?: readonly Pick<Agent, 'id' | 'provider'>[]
}

export type ComposerReference = {
  start: number
  end: number
  kind: 'file' | 'model' | 'skill' | 'mcp' | 'bot' | 'agent'
  label: string
  provider?: TaskHarness['provider']
}

export type ComposerReferenceIcon =
  | `file-${ReturnType<typeof fileIconKind>}`
  | 'skill'
  | 'mcp'
  | 'model'
export const composerReferenceIcon = (
  reference: Pick<ComposerReference, 'kind' | 'label'>,
): ComposerReferenceIcon =>
  reference.kind === 'file'
    ? `file-${fileIconKind(reference.label)}`
    : reference.kind === 'bot' || reference.kind === 'agent'
      ? 'model'
      : reference.kind

const scopedAgentReference = /^agent:[^/]+\/[^/]*\/([^/]+)$/

export function composerAgentReferenceProvider(
  reference: string,
  agents: ComposerReferenceResources['agents'],
): ComposerReference['provider'] {
  const encodedId = scopedAgentReference.exec(reference)?.[1]
  if (!encodedId || !agents?.length) return
  try {
    const id = decodeURIComponent(encodedId)
    return agents.find((agent) => agent.id === id)?.provider
  } catch {
    return
  }
}

/** Recognize saved mentions even when their agent or Bot is no longer available. */
function savedMentionReferences(
  text: string,
  agents: ComposerReferenceResources['agents'],
): ComposerReference[] {
  const found: ComposerReference[] = []
  for (const match of maskFileMentions(text).matchAll(
    /(^|\s)@([^@\n\r`]+?) \(`((?:studio|agent):[^`\s]+)`\)/g,
  )) {
    const kind = scopedAgentReference.test(match[3]) ? 'agent' : 'bot'
    if ((kind === 'bot' && parseStudioReference(match[3])?.kind !== 'thread') || !match[2].trim())
      continue
    const start = match.index! + match[1].length
    const provider = kind === 'agent' ? composerAgentReferenceProvider(match[3], agents) : undefined
    found.push({
      start,
      end: match.index! + match[0].length,
      kind,
      label: `@${match[2]}`,
      ...(provider ? { provider } : {}),
    })
  }
  return found
}

export function composerTextReferences(
  text: string,
  resources: ComposerReferenceResources,
): ComposerReference[] {
  const filename = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
  const found: ComposerReference[] = explicitFileMentions(text)
    .filter((file) => file.end < text.length)
    .map(({ start, end, path }) => ({ start, end, kind: 'file', label: filename(path) }))
  for (const match of maskFileMentions(text).matchAll(/(^|\s)([@$])([^\s@]+)(?=\s)/g)) {
    const name = match[3]
    if (match[2] === '@' && name.startsWith('file:')) continue
    const start = match.index + match[1].length
    const end = match.index + match[0].length
    const kind =
      match[2] === '$'
        ? resources.skills.some((skill) => skill.name === name) && 'skill'
        : resources.mcpServers.some((server) => server.enabled && server.name === name)
          ? 'mcp'
          : /[\\/]|\.[\w-]+$/.test(name) && 'file'
    if (kind)
      found.push({
        start,
        end,
        kind,
        label: kind === 'file' ? filename(name) : name,
      })
  }
  return found.sort((a, b) => a.start - b.start)
}

export function composerModelReference(
  text: string,
  agents: ComposerReferenceResources['agents'] = [],
): ComposerReference | undefined {
  const match = /^model:([^\s/]{1,600})\/([^\s]{1,1000})$/.exec(text)
  if (!match) return
  try {
    const harness = decodeURIComponent(match[1])
    const model = decodeURIComponent(match[2])
    if (
      !harness ||
      !model ||
      (harness + model).split('').some((character) => {
        const code = character.charCodeAt(0)
        return code < 32 || code === 127
      })
    )
      return
    const provider = harness.startsWith('acp:')
      ? 'acp'
      : harness.startsWith('agent:')
        ? agents.find((agent) => agent.id === harness.slice(6))?.provider
        : providerSchema.literals.find((provider) => harness === `harness:${provider}`)
    return {
      start: 0,
      end: text.length,
      kind: 'model',
      label: model,
      ...(provider ? { provider } : {}),
    }
  } catch {
    return
  }
}

/** Source offsets use UTF-16, as native text fields and JavaScript selections do. */
export function composerReferences(
  text: string,
  resources: ComposerReferenceResources,
): ComposerReference[] {
  if (!/[@$`]/.test(text)) return []
  const found: ComposerReference[] = []
  const references = composerTextReferences(text, resources)
  const fileRanges = references.filter(
    (item) => item.kind === 'file' && text.startsWith('@file:', item.start),
  )
  const excluded: { start: number; end: number; code: boolean }[] = []
  const visit = (node: ReturnType<typeof fromMarkdown>['children'][number]): void => {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start !== undefined && end !== undefined) {
      if (fileRanges.some((file) => start > file.start && end < file.end)) return
      if (
        [
          'heading',
          'code',
          'inlineCode',
          'link',
          'linkReference',
          'image',
          'imageReference',
        ].includes(node.type)
      )
        excluded.push({ start, end, code: node.type === 'inlineCode' })
      if (node.type === 'inlineCode') {
        const reference = composerModelReference(node.value, resources.agents)
        if (reference) found.push({ ...reference, start, end })
        return
      }
    }
    if (['heading', 'code', 'link', 'linkReference', 'image', 'imageReference'].includes(node.type))
      return
    if ('children' in node) for (const child of node.children) visit(child)
  }
  for (const node of fromMarkdown(text).children) visit(node)
  for (const reference of savedMentionReferences(text, resources.agents))
    if (
      !excluded.some(
        (range) =>
          reference.start < range.end &&
          reference.end > range.start &&
          !(range.code && range.start > reference.start && range.end < reference.end),
      )
    )
      found.push(reference)
  // File paths can contain Markdown punctuation such as __tests__. Match the complete
  // source token, then exclude code and links rather than splitting the path at style marks.
  for (const reference of references)
    if (
      !excluded.some((range) => reference.start < range.end && reference.end > range.start) &&
      !found.some((range) => reference.start < range.end && reference.end > range.start)
    )
      found.push(reference)
  return found.sort((a, b) => a.start - b.start)
}

/** Sent text has no unfinished caret token. Keep offsets in the unchanged message source. */
export function messageReferences(text: string, resources: ComposerReferenceResources) {
  return composerReferences(`${text} `, resources)
}
