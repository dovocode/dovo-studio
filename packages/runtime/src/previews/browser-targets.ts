import { randomUUID } from 'node:crypto'
import type { Page } from 'playwright'
import { Schema } from 'effect'
import { decode, mutableStruct } from '@dovo/protocol'
import { HttpError } from '../errors.js'

const targets = new WeakMap<Page, Map<string, string>>()
const namespace = randomUUID().slice(0, 8)
let sequence = 0
export const nextBrowserSnapshotId = () => `${namespace}-${(++sequence).toString(36)}`
const treeNodeSchema = mutableStruct({
  role: Schema.String,
  name: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
  ref: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  checked: Schema.optional(Schema.Union([Schema.Boolean, Schema.Literal('mixed')])),
  pressed: Schema.optional(Schema.Union([Schema.Boolean, Schema.Literal('mixed')])),
  disabled: Schema.optional(Schema.Boolean),
  expanded: Schema.optional(Schema.Boolean),
  selected: Schema.optional(Schema.Boolean),
  active: Schema.optional(Schema.Boolean),
  invalid: Schema.optional(Schema.Boolean),
  level: Schema.optional(Schema.Number),
  children: Schema.optional(Schema.Array(Schema.Unknown)),
})
export const staleBrowserRef = () =>
  new HttpError(
    409,
    'This element reference is stale or belongs to another tab. Take a fresh snapshot and use its ref.',
  )

/** Namespace Playwright refs so they cannot alias another tab or an earlier snapshot. */
export async function browserTree(page: Page) {
  if (!targets.has(page)) {
    page.on('framenavigated', () => targets.get(page)?.clear())
    page.on('framedetached', () => targets.get(page)?.clear())
  }
  const refs = new Map<string, string>()
  targets.set(page, refs)
  const tree: unknown = await page.ariaSnapshotJSON({ mode: 'ai', timeout: 10000 })
  const generation = nextBrowserSnapshotId()
  const lines: string[] = []
  let length = 0
  let snapshotTruncated = false
  const append = (line: string) => {
    if (length + line.length + 1 > 32000) {
      snapshotTruncated = true
      return false
    }
    lines.push(line)
    length += line.length + 1
    return true
  }
  const visit = (value: unknown, depth: number) => {
    if (snapshotTruncated) return
    if (length >= 32000 || depth > 40) {
      snapshotTruncated = true
      return
    }
    const indent = '  '.repeat(depth)
    if (typeof value === 'string') {
      append(`${indent}- text: ${JSON.stringify(value)}`)
      return
    }
    const node = decode(treeNodeSchema, value)
    const ref = node.ref ? `${generation}-${node.ref}` : undefined
    const states = Object.entries(node)
      .filter(
        ([key, value]) =>
          [
            'checked',
            'pressed',
            'disabled',
            'expanded',
            'selected',
            'active',
            'invalid',
            'level',
          ].includes(key) && value !== undefined,
      )
      .map(([key, value]) => ` [${key}=${JSON.stringify(value)}]`)
      .join('')
    // Input values have a separate typed home in elements; do not copy password values from ARIA.
    const text = !['textbox', 'searchbox', 'spinbutton', 'combobox'].includes(node.role)
      ? node.text
      : undefined
    if (
      !append(
        `${indent}- ${node.role}${node.name ? ` ${JSON.stringify(node.name)}` : ''}${ref ? ` [ref=${ref}]` : ''}${states}${text ? `: ${JSON.stringify(text)}` : ''}`,
      )
    )
      return
    if (ref && node.ref) refs.set(ref, node.ref)
    if (node.url) append(`${indent}  - /url: ${JSON.stringify(node.url)}`)
    for (const child of node.children ?? []) visit(child, depth + 1)
  }
  for (const node of decode(Schema.Array(Schema.Unknown), tree)) visit(node, 0)
  return { snapshot: lines.join('\n'), snapshotTruncated }
}

export function browserLocator(page: Page, selector: string) {
  if (selector.startsWith('ref=')) {
    const native = targets.get(page)?.get(selector.slice(4))
    if (!native) throw staleBrowserRef()
    return page.locator(`aria-ref=${native}`)
  }
  // Do not allow a raw Playwright ref to bypass the tab and snapshot namespace.
  const engines = selector.replace(/\\.|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, ' ')
  if (/(?:^|>>)\s*\*?aria-ref\s*=/.test(engines)) throw staleBrowserRef()
  return page.locator(selector)
}
