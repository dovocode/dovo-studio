import { decode } from './shared/schema.js'
import {
  extensionViewLimits,
  type ExtensionViewNode,
  type ExtensionViewValue,
} from './runtime/studio-extension-views.js'
import {
  extensionViewContributionSchema,
  studioExtensionManifestSchema,
  type StudioExtensionManifest,
} from './runtime/studio-extensions.js'

export type {
  ExtensionContribution,
  ExtensionSettingValue,
  StudioExtensionManifest,
} from './runtime/studio-extensions.js'
export type { ExtensionViewValue } from './runtime/studio-extension-views.js'

type Node<Kind extends ExtensionViewNode['kind']> = Extract<ExtensionViewNode, { kind: Kind }>
type Layout = 'stack' | 'row' | 'card'
type Panel = 'dialog' | 'disclosure'

/** Component definitions use nested children. The manifest stores them by ID. */
export type StudioViewComponent =
  | Exclude<ExtensionViewNode, Node<Layout | Panel | 'tabs' | 'custom'>>
  | (Omit<Node<'stack'>, 'children'> & { children: StudioViewComponent[] })
  | (Omit<Node<'row'>, 'children'> & { children: StudioViewComponent[] })
  | (Omit<Node<'card'>, 'children'> & { children: StudioViewComponent[] })
  | (Omit<Node<'dialog'>, 'child'> & { child: StudioViewComponent })
  | (Omit<Node<'disclosure'>, 'child'> & { child: StudioViewComponent })
  | (Omit<Node<'tabs'>, 'items'> & {
      items: Array<{ label: Node<'tabs'>['items'][number]['label']; child: StudioViewComponent }>
    })
  | (Omit<Node<'custom'>, 'fallback'> & { fallback: StudioViewComponent })

type ViewContribution = typeof extensionViewContributionSchema.Type

export function view(
  input: Omit<ViewContribution, 'kind' | 'view'> & { root: StudioViewComponent },
): ViewContribution {
  const ids = new Set<string>()
  const nodes: ExtensionViewNode[] = []

  function add(node: StudioViewComponent, depth: number): string {
    if (depth > extensionViewLimits.depth)
      throw new Error(`Component depth must be at most ${extensionViewLimits.depth}.`)
    if (ids.has(node.id)) throw new Error(`Component IDs must be unique. Duplicate ID: ${node.id}`)
    if (ids.size >= extensionViewLimits.nodes)
      throw new Error(`A view can have at most ${extensionViewLimits.nodes} components.`)
    ids.add(node.id)

    switch (node.kind) {
      case 'stack':
      case 'row':
      case 'card':
        nodes.push({ ...node, children: node.children.map((child) => add(child, depth + 1)) })
        break
      case 'disclosure':
      case 'dialog':
        nodes.push({ ...node, child: add(node.child, depth + 1) })
        break
      case 'tabs':
        nodes.push({
          ...node,
          items: node.items.map(({ label, child }) => ({ label, child: add(child, depth + 1) })),
        })
        break
      case 'custom':
        nodes.push({ ...node, fallback: add(node.fallback, depth + 1) })
        break
      default:
        nodes.push(node)
    }
    return node.id
  }

  const { root, ...fields } = input
  return decode(extensionViewContributionSchema, {
    ...fields,
    kind: 'view',
    view: { version: 1, root: add(root, 1), nodes },
  })
}

/** Build a v1 manifest and check references to settings and declared tools. */
export function defineExtension(
  input: Omit<StudioExtensionManifest, 'version'>,
): StudioExtensionManifest {
  return decode(studioExtensionManifestSchema, { ...input, version: 1 })
}

export function setting(id: string): Extract<ExtensionViewValue, { setting: string }> {
  return { setting: id }
}

export function result(
  tool: string,
  ...path: string[]
): Extract<ExtensionViewValue, { result: string }> {
  return path.length ? { result: tool, path } : { result: tool }
}
