import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'
import { expect, it } from 'vite-plus/test'
import catalog from '../../../packages/studio-core/src/interface-catalog.json'

const root = fileURLToPath(new URL('./', import.meta.url))
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`
    return entry.isDirectory()
      ? files(path)
      : /\.[jt]sx?$/.test(path) && !/\.(?:test|stories)\./.test(path)
        ? [path]
        : []
  })
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {}
}
function walk(value: unknown, visit: (node: Record<string, unknown>) => void) {
  if (Array.isArray(value)) return value.forEach((child) => walk(child, visit))
  const node = object(value)
  if (typeof node.type !== 'string') return
  visit(node)
  for (const [key, child] of Object.entries(node)) {
    if (!['loc', 'extra', 'comments', 'tokens'].includes(key)) walk(child, visit)
  }
}
const uiProps = new Set([
  'label',
  'title',
  'subtitle',
  'description',
  'hint',
  'footer',
  'placeholder',
  'accessibilityLabel',
  'accessibilityHint',
  'emptyText',
  'searchPlaceholder',
  'confirmLabel',
  'cancelLabel',
  'selectedLabel',
  'dismissLabel',
])
// Source examples and product names stay literal. User text never enters the catalog here.
function technical(text: string) {
  return (
    !/[a-zA-Z]{2}/.test(text) ||
    /^(?:https?:|file:|\/|\.\/|\$|#[\da-f]+$|20\d\d-)/i.test(text) ||
    /^(?:~\/|[A-Z][A-Z0-9]*_[A-Z0-9_]+$)/.test(text) ||
    ['Dovo', 'GitHub', 'skills.sh', '15m, 1h, 4h, 1d', 'pnpm install --frozen-lockfile'].includes(
      text,
    )
  )
}

function unmarkedCopy(value: unknown): string[] {
  const node = object(value)
  if (node.type === 'StringLiteral' && typeof node.value === 'string')
    return technical(node.value) ? [] : [node.value]
  if (node.type === 'TemplateLiteral') {
    const quasis = Array.isArray(node.quasis) ? node.quasis : []
    const expressions = Array.isArray(node.expressions) ? node.expressions : []
    return [
      ...quasis.flatMap((part) => {
        const text = object(object(part).value).cooked
        return typeof text === 'string' && !technical(text) ? [text] : []
      }),
      ...expressions.flatMap(unmarkedCopy),
    ]
  }
  if (node.type === 'ConditionalExpression')
    return [...unmarkedCopy(node.consequent), ...unmarkedCopy(node.alternate)]
  if (node.type === 'LogicalExpression' || node.type === 'BinaryExpression')
    return [...unmarkedCopy(node.left), ...unmarkedCopy(node.right)]
  return []
}

it('bundles every marked mobile message and prevents new untranslated JSX copy', () => {
  const missing = new Set<string>()
  const unmarked: string[] = []
  const en: Readonly<Record<string, string>> = catalog.en
  const requireCopy = (value: unknown) => {
    const node = object(value)
    if (node.type === 'StringLiteral' && typeof node.value === 'string' && !en[node.value])
      missing.add(node.value)
  }
  for (const file of files(root)) {
    // Widget extensions serialize SwiftUI separately and cannot run React context hooks.
    if (
      file.endsWith('/widgets/tasks-widget.tsx') ||
      file.endsWith('/live-activities/task-activity.tsx')
    )
      continue
    const tree = parse(readFileSync(file, 'utf8'), {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    })
    walk(tree, (node) => {
      if (node.type === 'CallExpression' && object(node.callee).name === 'uiText')
        requireCopy(Array.isArray(node.arguments) ? node.arguments[0] : undefined)
      if (
        node.type === 'JSXElement' &&
        object(object(node.openingElement).name).name === 'InterfaceText'
      ) {
        for (const child of Array.isArray(node.children) ? node.children : [])
          requireCopy(object(child).expression)
      }
      if (node.type === 'JSXAttribute' && uiProps.has(String(object(node.name).name))) {
        const value = object(node.value)
        if (
          value.type === 'StringLiteral' &&
          typeof value.value === 'string' &&
          !technical(value.value)
        )
          unmarked.push(`${file.slice(root.length + 1)}: ${value.value}`)
        if (value.type === 'JSXExpressionContainer')
          for (const text of unmarkedCopy(value.expression))
            unmarked.push(`${file.slice(root.length + 1)}: ${text}`)
      }
      if (node.type === 'JSXText' && typeof node.value === 'string') {
        const value = node.value.trim().replace(/\s+/g, ' ')
        if (value && !technical(value)) unmarked.push(`${file.slice(root.length + 1)}: ${value}`)
      }
    })
  }
  expect.soft([...missing].sort()).toEqual([])
  expect.soft(unmarked).toEqual([])
})
