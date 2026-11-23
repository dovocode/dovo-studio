import { studioDataPanelsSchema } from './studio-data-sources.js'
import { Schema } from 'effect'
import { mutableArray, refine, strictStruct } from '../shared/schema.js'

const extensionKeyPattern = /^[a-z][a-z0-9.-]{0,63}$/
export const extensionKeySchema = Schema.String.check(
  Schema.isPattern(extensionKeyPattern),
).annotate({ pattern: extensionKeyPattern.source })
const key = extensionKeySchema
const label = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100))
const shortText = Schema.String.check(Schema.isMaxLength(4096))
const list = <S extends Schema.Top>(item: S, limit: number) =>
  mutableArray(item).check(Schema.isMaxLength(limit))
const binding = Schema.Union([
  strictStruct({ setting: key }),
  strictStruct({
    result: key,
    path: Schema.optionalKey(list(label, 8)),
  }),
])
const value = Schema.Union([shortText, Schema.Finite, Schema.Boolean, binding])
const choice = strictStruct({ label, value: label })
const panel = strictStruct({ label, child: key })
const action = strictStruct({ label, action: key })
const coordinate = Schema.Finite.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(1000),
)
const tone = Schema.Literals(['normal', 'muted', 'accent', 'danger'])
const shape = Schema.Union([
  strictStruct({
    kind: Schema.Literal('rect'),
    x: coordinate,
    y: coordinate,
    width: coordinate,
    height: coordinate,
    tone,
  }),
  strictStruct({
    kind: Schema.Literal('circle'),
    x: coordinate,
    y: coordinate,
    radius: coordinate,
    tone,
  }),
  strictStruct({ kind: Schema.Literal('text'), x: coordinate, y: coordinate, value, tone }),
])
const customProps = refine(
  Schema.Record(Schema.String, Schema.Json),
  (props) => {
    try {
      return JSON.stringify(props).length <= 8192
    } catch {
      return false
    }
  },
  'Custom props must fit in 8,192 JSON characters',
)
const id = { id: key }
const title = { label }
export const extensionViewComponents = {
  stack: strictStruct({ ...id, kind: Schema.Literal('stack'), children: list(key, 24) }),
  row: strictStruct({ ...id, kind: Schema.Literal('row'), children: list(key, 24) }),
  card: strictStruct({
    ...id,
    kind: Schema.Literal('card'),
    label: Schema.optionalKey(label),
    children: list(key, 24),
  }),
  separator: strictStruct({ ...id, kind: Schema.Literal('separator') }),
  text: strictStruct({
    ...id,
    kind: Schema.Literal('text'),
    value,
    style: Schema.optionalKey(Schema.Literals(['body', 'heading', 'muted', 'code'])),
  }),
  badge: strictStruct({ ...id, kind: Schema.Literal('badge'), value }),
  status: strictStruct({
    ...id,
    kind: Schema.Literal('status'),
    value,
    tone: Schema.optionalKey(tone),
  }),
  empty: strictStruct({ ...id, kind: Schema.Literal('empty'), ...title, description: shortText }),
  button: strictStruct({ ...id, kind: Schema.Literal('button'), ...title, action: key }),
  menu: strictStruct({
    ...id,
    kind: Schema.Literal('menu'),
    ...title,
    items: list(action, 12).check(Schema.isMinLength(1)),
  }),
  input: strictStruct({ ...id, kind: Schema.Literal('input'), ...title, setting: key }),
  textarea: strictStruct({ ...id, kind: Schema.Literal('textarea'), ...title, setting: key }),
  switch: strictStruct({ ...id, kind: Schema.Literal('switch'), ...title, setting: key }),
  checkbox: strictStruct({ ...id, kind: Schema.Literal('checkbox'), ...title, setting: key }),
  select: strictStruct({
    ...id,
    kind: Schema.Literal('select'),
    ...title,
    setting: key,
    items: list(choice, 24).check(Schema.isMinLength(1)),
  }),
  tabs: strictStruct({
    ...id,
    kind: Schema.Literal('tabs'),
    ...title,
    items: list(panel, 12).check(Schema.isMinLength(1)),
  }),
  disclosure: strictStruct({ ...id, kind: Schema.Literal('disclosure'), ...title, child: key }),
  dialog: strictStruct({ ...id, kind: Schema.Literal('dialog'), ...title, child: key }),
  app: strictStruct({ ...id, kind: Schema.Literal('app'), source: key }),
  'data-grid': strictStruct({
    ...id,
    kind: Schema.Literal('data-grid'),
    value: binding,
    panels: studioDataPanelsSchema,
  }),
  'data-source': strictStruct({ ...id, kind: Schema.Literal('data-source'), source: key }),
  table: strictStruct({ ...id, kind: Schema.Literal('table'), ...title, value: binding }),
  chart: strictStruct({ ...id, kind: Schema.Literal('chart'), ...title, value: binding }),
  metric: strictStruct({ ...id, kind: Schema.Literal('metric'), ...title, value }),
  custom: strictStruct({
    ...id,
    kind: Schema.Literal('custom'),
    ...title,
    fallback: key,
    component: strictStruct({
      type: key,
      props: Schema.optionalKey(customProps),
      shapes: Schema.optionalKey(list(shape, 48)),
      actions: Schema.optionalKey(list(action, 8)),
    }),
  }),
}

export const extensionViewLimits = { nodes: 64, depth: 12 } as const

const node = Schema.Union(Object.values(extensionViewComponents))
export const extensionViewSchema = strictStruct({
  version: Schema.Literal(1),
  root: key,
  nodes: list(node, extensionViewLimits.nodes).check(Schema.isMinLength(1)),
})

export type ExtensionView = typeof extensionViewSchema.Type
export type ExtensionViewNode = typeof node.Type
export type ExtensionViewValue = typeof value.Type

export function extensionViewHasApp(view: ExtensionView) {
  return view.nodes.some((node) => node.kind === 'app')
}

export function extensionViewChildren(node: ExtensionViewNode): string[] {
  switch (node.kind) {
    case 'stack':
    case 'row':
    case 'card':
      return node.children
    case 'tabs':
      return node.items.map(({ child }) => child)
    case 'disclosure':
    case 'dialog':
      return [node.child]
    case 'custom':
      return [node.fallback]
    default:
      return []
  }
}

function extensionViewNodeValues(node: ExtensionViewNode): ExtensionViewValue[] {
  if ('value' in node) return [node.value]
  if (node.kind !== 'custom') return []
  return (
    node.component.shapes?.flatMap((shape) => (shape.kind === 'text' ? [shape.value] : [])) ?? []
  )
}

export function extensionViewResultIds(view: ExtensionView) {
  return new Set(
    view.nodes.flatMap((node) => {
      if (node.kind === 'data-source') return [node.source]
      return extensionViewNodeValues(node).flatMap((value) =>
        typeof value === 'object' && 'result' in value ? [value.result] : [],
      )
    }),
  )
}

function extensionViewNodeActions(node: ExtensionViewNode) {
  return node.kind === 'button'
    ? [node]
    : node.kind === 'menu'
      ? node.items
      : node.kind === 'custom'
        ? (node.component.actions ?? [])
        : []
}

export function extensionViewActionIds(view: ExtensionView) {
  return new Set(
    view.nodes.flatMap((node) => extensionViewNodeActions(node).map(({ action }) => action)),
  )
}

export function extensionViewIssue(
  view: ExtensionView,
  settings: ReadonlyMap<string, string | boolean>,
  tools: ReadonlySet<string>,
  results: ReadonlySet<string> = tools,
  apps: ReadonlySet<string> = new Set(),
): string | undefined {
  const nodes = new Map(view.nodes.map((node) => [node.id, node]))
  if (nodes.size !== view.nodes.length) return 'Component IDs must be unique.'
  const visited = new Set<string>()
  function visit(id: string, depth: number, fallback: boolean): string | undefined {
    const node = nodes.get(id)
    if (!node) return `Unknown component: ${id}`
    if (depth > extensionViewLimits.depth)
      return `Component depth must be at most ${extensionViewLimits.depth}.`
    if (visited.has(id)) return `Component ${id} must have exactly one place in the tree.`
    if (fallback && node.kind === 'custom') return 'Use Studio components in a custom fallback.'
    visited.add(id)
    for (const child of extensionViewChildren(node)) {
      const issue = visit(child, depth + 1, fallback || node.kind === 'custom')
      if (issue) return issue
    }
  }
  const treeIssue = visit(view.root, 1, false)
  if (treeIssue) return treeIssue
  if (visited.size !== nodes.size) return 'All components must belong to the view tree.'
  const sourceControls = new Set<string>()
  for (const node of view.nodes) {
    if (node.kind === 'app' && !apps.has(node.source)) return `Unknown MCP App: ${node.source}`
    if (node.kind === 'data-source') {
      if (!results.has(node.source) || tools.has(node.source))
        return `Unknown data source: ${node.source}`
      if (sourceControls.has(node.source))
        return `A view can have only one refresh control for data source ${node.source}.`
      sourceControls.add(node.source)
    }
    if ('setting' in node) {
      const type = node.kind === 'checkbox' || node.kind === 'switch' ? 'boolean' : 'string'
      const setting = settings.get(node.setting)
      if (typeof setting !== type) return `Component ${node.id} requires a ${type} setting.`
      if (node.kind === 'select') {
        const choices = new Set(node.items.map((item) => item.value))
        if (choices.size !== node.items.length) return `Component ${node.id} has duplicate choices.`
      }
    }
    for (const { action } of extensionViewNodeActions(node))
      if (!tools.has(action)) return `Unknown tool action: ${action}`
    if (
      node.kind === 'custom' &&
      node.component.type === 'diagram' &&
      !node.component.shapes?.length
    )
      return `Custom diagram ${node.id} requires shapes.`
    for (const value of extensionViewNodeValues(node)) {
      if (typeof value !== 'object') continue
      if ('setting' in value && !settings.has(value.setting))
        return `Unknown setting: ${value.setting}`
      if ('result' in value && !results.has(value.result))
        return `Unknown tool result: ${value.result}`
    }
  }
}
