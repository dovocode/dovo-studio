import { Schema } from 'effect'
import { mutableStruct } from '@dovo/protocol/agent-tools'

export const browserObservationSchema = mutableStruct({
  elements: Schema.Array(
    mutableStruct({
      selector: Schema.String,
      tag: Schema.String,
      name: Schema.String,
      role: Schema.optional(Schema.String),
      type: Schema.optional(Schema.String),
      value: Schema.optional(Schema.String),
      checked: Schema.optional(Schema.Boolean),
      disabled: Schema.optional(Schema.Boolean),
      readOnly: Schema.optional(Schema.Boolean),
      required: Schema.optional(Schema.Boolean),
      href: Schema.optional(Schema.String),
      frameUrl: Schema.optional(Schema.String),
      validationMessage: Schema.optional(Schema.String),
      options: Schema.optional(
        Schema.Array(
          mutableStruct({
            label: Schema.String,
            value: Schema.String,
            selected: Schema.Boolean,
            disabled: Schema.Boolean,
          }),
        ),
      ),
      optionsTruncated: Schema.optional(Schema.Boolean),
    }),
  ),
  elementsTruncated: Schema.Boolean,
})
export type BrowserObservation = Schema.Schema.Type<typeof browserObservationSchema>

/** Serialized into the page. Read live DOM state without changing the page or adding attributes. */
export function readBrowserObservation(): BrowserObservation {
  const clean = (text: string | null | undefined, limit = 500) =>
    (text ?? '').replace(/\s+/g, ' ').trim().slice(0, limit)
  const selectorFor = (element: Element) => {
    const path: string[] = []
    let current: Element | null = element
    while (current) {
      if (current.id && document.querySelectorAll('#' + CSS.escape(current.id)).length === 1) {
        path.unshift('#' + CSS.escape(current.id))
        break
      }
      const tag = current.localName
      const siblings: Element[] = current.parentElement
        ? Array.from(current.parentElement.children).filter((child) => child.localName === tag)
        : [current]
      path.unshift(
        CSS.escape(tag) +
          (siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : ''),
      )
      current = current.parentElement
    }
    return path.join(' > ')
  }
  const elements: BrowserObservation['elements'][number][] = []
  let elementsTruncated = false
  let size = 2
  for (const element of document.querySelectorAll(
    'a[href], button, input, textarea, select, summary, [contenteditable]:not([contenteditable="false"]), [role], iframe',
  )) {
    if (!element.checkVisibility({ checkVisibilityCSS: true })) continue
    if (elements.length === 150) {
      elementsTruncated = true
      break
    }
    const input = element instanceof HTMLInputElement ? element : undefined
    const field =
      input ??
      (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
        ? element
        : undefined)
    const labelledBy = element.getAttribute('aria-labelledby')
    const label = labelledBy
      ?.split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
    const labels =
      field?.labels &&
      Array.from(field.labels, (label) => {
        const copy = label.cloneNode(true)
        if (!(copy instanceof Element)) return ''
        for (const control of copy.querySelectorAll('input, textarea, select, button'))
          control.remove()
        return copy.textContent
      }).join(' ')
    const detail: BrowserObservation['elements'][number] = {
      selector: selectorFor(element),
      tag: element.localName,
      name: clean(
        label ||
          element.getAttribute('aria-label') ||
          labels ||
          element.getAttribute('placeholder') ||
          element.getAttribute('title') ||
          (input && ['submit', 'button', 'reset'].includes(input.type)
            ? input.value
            : field
              ? ''
              : element.textContent),
      ),
      ...(element.hasAttribute('role') ? { role: element.getAttribute('role') ?? '' } : {}),
      ...(input ? { type: input.type } : {}),
      ...(field
        ? {
            // Passwords and file paths are not needed to inspect form state.
            ...(!input || !['password', 'file'].includes(input.type)
              ? { value: field.value.slice(0, 2000) }
              : {}),
            disabled: field.matches(':disabled'),
            required: field.required,
            ...(field.validationMessage
              ? { validationMessage: clean(field.validationMessage) }
              : {}),
          }
        : {}),
      ...(input || element instanceof HTMLTextAreaElement
        ? { readOnly: (input ?? element).hasAttribute('readonly') }
        : {}),
      ...(input && ['checkbox', 'radio'].includes(input.type) ? { checked: input.checked } : {}),
      ...(element instanceof HTMLButtonElement ? { disabled: element.matches(':disabled') } : {}),
      ...(element instanceof HTMLAnchorElement ? { href: element.href.slice(0, 4096) } : {}),
      ...(element instanceof HTMLIFrameElement ? { frameUrl: element.src.slice(0, 4096) } : {}),
      ...(element instanceof HTMLSelectElement
        ? {
            options: Array.from(element.options)
              .slice(0, 50)
              .map((option) => ({
                label: clean(option.label),
                value: option.value.slice(0, 2000),
                selected: option.selected,
                disabled:
                  option.disabled || option.parentElement?.matches('optgroup:disabled') === true,
              })),
            optionsTruncated: element.options.length > 50,
          }
        : {}),
    }
    const length = JSON.stringify(detail).length + (elements.length ? 1 : 0)
    if (size + length > 32000) {
      elementsTruncated = true
      break
    }
    elements.push(detail)
    size += length
  }
  return { elements, elementsTruncated }
}
