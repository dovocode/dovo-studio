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
  kind: 'file' | 'model' | 'skill' | 'mcp'
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
  reference.kind === 'file' ? `file-${fileIconKind(reference.label)}` : reference.kind

export function composerTextReferences(
  text: string,
  resources: ComposerReferenceResources,
): ComposerReference[] {
  const found: ComposerReference[] = []
  for (const match of text.matchAll(/(^|\s)([@$])([^\s@]+)/g)) {
    const name = match[3]
    const start = match.index! + match[1].length
    const end = start + name.length + 1
    // A trailing boundary completes the token. Never capture the path still being typed.
    if (end === text.length) continue
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
        label: kind === 'file' ? (name.split(/[\\/]/).filter(Boolean).at(-1) ?? name) : name,
      })
  }
  return found
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
  const excluded: { start: number; end: number }[] = []
  const visit = (node: ReturnType<typeof fromMarkdown>['children'][number]): void => {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start !== undefined && end !== undefined) {
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
        excluded.push({ start, end })
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
  // File paths can contain Markdown punctuation such as __tests__. Match the complete
  // source token, then exclude code and links rather than splitting the path at style marks.
  for (const reference of composerTextReferences(text, resources))
    if (!excluded.some((range) => reference.start < range.end && reference.end > range.start))
      found.push(reference)
  return found.sort((a, b) => a.start - b.start)
}
