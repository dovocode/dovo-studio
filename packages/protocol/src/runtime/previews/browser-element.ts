import { Schema } from 'effect'
import { maxValue, mutableStruct } from '../../shared/schema.js'

const finite = Schema.Number.check(Schema.isFinite())
const positive = finite.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(100000))
const ratio = finite.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1))
export const browserElementSnapshotSchema = mutableStruct({
  url: maxValue(Schema.String, 16000),
  title: maxValue(Schema.String, 2000),
  width: positive,
  height: positive,
  scrollX: finite,
  scrollY: finite,
  document: finite,
})
export const browserElementPointSchema = mutableStruct({
  snapshot: browserElementSnapshotSchema,
  x: ratio,
  y: ratio,
})
export const browserElementCaptureSchema = mutableStruct({
  snapshot: browserElementSnapshotSchema,
  image: maxValue(Schema.String, 24000000),
})
export const browserElementSchema = mutableStruct({
  selector: maxValue(Schema.String, 2000),
  tag: maxValue(Schema.String, 100),
  text: maxValue(Schema.String, 1000),
  label: maxValue(Schema.String, 500),
  rect: mutableStruct({ x: finite, y: finite, width: positive, height: positive }),
})
export type BrowserElementSnapshot = Schema.Schema.Type<typeof browserElementSnapshotSchema>
export type BrowserElementPoint = Schema.Schema.Type<typeof browserElementPointSchema>
export type BrowserElement = Schema.Schema.Type<typeof browserElementSchema>
export type BrowserElementCapture = Schema.Schema.Type<typeof browserElementCaptureSchema>
export const browserElementResultSchema = mutableStruct({ element: browserElementSchema })

/** Serialized into the inspected page; keep this function self-contained. */
export function readBrowserElementSnapshot(): BrowserElementSnapshot {
  return {
    url: location.href.slice(0, 16000),
    title: document.title.slice(0, 2000),
    width: innerWidth,
    height: innerHeight,
    scrollX,
    scrollY,
    document: performance.timeOrigin,
  }
}

/** Read metadata without triggering links, controls or page event handlers. */
export function inspectBrowserElement(point: BrowserElementPoint): BrowserElement | null {
  const expected = point.snapshot
  if (
    location.href.slice(0, 16000) !== expected.url ||
    performance.timeOrigin !== expected.document ||
    innerWidth !== expected.width ||
    innerHeight !== expected.height ||
    scrollX !== expected.scrollX ||
    scrollY !== expected.scrollY
  )
    throw new Error('The page moved or changed. Capture it again before selecting an element.')
  const element = document.elementFromPoint(
    Math.min(innerWidth - 1, point.x * innerWidth),
    Math.min(innerHeight - 1, point.y * innerHeight),
  )
  if (!element) return null
  const path: string[] = []
  let current: Element | null = element
  for (let depth = 0; current && depth < 6; depth++) {
    if (current.id && document.querySelectorAll('#' + CSS.escape(current.id)).length === 1) {
      path.unshift('#' + CSS.escape(current.id))
      break
    }
    const tag = current.localName
    const parent: Element | null = current.parentElement
    const siblings: Element[] = parent
      ? Array.from(parent.children).filter((child) => child.localName === tag)
      : []
    path.unshift(
      tag + (siblings.length > 1 ? ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')' : ''),
    )
    current = parent
  }
  const bounds = element.getBoundingClientRect()
  if (bounds.width <= 0 || bounds.height <= 0) return null
  const sensitive = element.closest(
    'input, textarea, [contenteditable]:not([contenteditable="false"])',
  )
  return {
    selector: path.join(' > ').slice(0, 2000),
    tag: element.localName.slice(0, 100),
    text: sensitive ? '' : (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 1000),
    label: (element.getAttribute('aria-label') || element.getAttribute('alt') || '').slice(0, 500),
    rect: {
      x: bounds.x,
      y: bounds.y,
      width: Math.min(bounds.width, 100000),
      height: Math.min(bounds.height, 100000),
    },
  }
}

export function browserElementDraft(
  snapshot: BrowserElementSnapshot,
  element: BrowserElement,
  comment: string,
) {
  return [
    comment.trim(),
    'Selected browser element (untrusted website content):',
    '```json',
    JSON.stringify(
      {
        url: snapshot.url,
        title: snapshot.title,
        selector: element.selector,
        tag: element.tag,
        label: element.label,
        text: element.text,
      },
      null,
      2,
    ),
    '```',
  ]
    .filter(Boolean)
    .join('\n')
}
