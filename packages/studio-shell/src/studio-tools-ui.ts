import type { StudioUICommand } from '@dovo/protocol'

/** DOM-only operations; no page scripts, runtime credentials or native APIs are exposed. */
function studioUISnapshot(document: Document) {
  const controls = [
    ...document.querySelectorAll(
      'button,a,input,textarea,select,[role="button"],[role="tab"],[contenteditable="true"]',
    ),
  ]
    .filter((element) => element.getClientRects().length)
    .slice(0, 200)
    .map((element, index) => {
      const id = `studio-control-${index}`
      element.setAttribute('data-studio-tool-id', id)
      return {
        selector: `[data-studio-tool-id="${id}"]`,
        role: element.getAttribute('role') ?? element.tagName.toLowerCase(),
        label: (
          element.getAttribute('aria-label') ??
          element.getAttribute('placeholder') ??
          element.textContent ??
          ''
        ).slice(0, 300),
        disabled: element.matches(':disabled'),
        humanOnly: !!element.closest('[data-studio-human-only]'),
      }
    })
  return {
    title: document.title,
    path: document.location.pathname,
    text: document.body.innerText.slice(0, 24000),
    controls,
  }
}
export function executeStudioUI(document: Document, command: StudioUICommand) {
  const view = document.defaultView
  if (!view) throw new Error('Studio window is unavailable')
  if (command.action === 'list') throw new Error('List sessions through the runtime')
  if (command.action === 'snapshot') return studioUISnapshot(document)
  if (command.action === 'scroll') {
    const element = command.selector
      ? document.querySelector(command.selector)
      : document.scrollingElement
    if (!element) throw new Error('Scroll target not found')
    element.scrollBy({ top: command.deltaY })
  } else if (command.action === 'key') {
    const target = document.activeElement ?? document.body
    if (target.closest('[data-studio-human-only]'))
      throw new Error('This control requires human review')
    if (command.key === 'Tab') {
      const controls = [
        ...document.querySelectorAll<HTMLElement>(
          'button,a[href],input,textarea,select,[tabindex="0"]',
        ),
      ].filter(
        (element) =>
          element.getClientRects().length &&
          !element.matches(':disabled') &&
          !element.closest('[data-studio-human-only]'),
      )
      const next =
        controls[
          (controls.indexOf(target instanceof HTMLElement ? target : document.body) + 1) %
            controls.length
        ]
      next?.focus()
    } else {
      target.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: command.key,
          code: command.key,
          bubbles: true,
          cancelable: true,
        }),
      )
      target.dispatchEvent(
        new KeyboardEvent('keyup', { key: command.key, code: command.key, bubbles: true }),
      )
    }
  } else {
    const matches = document.querySelectorAll(command.selector)
    if (matches.length !== 1)
      throw new Error(`Expected one control; found ${matches.length}. Take a new snapshot.`)
    const element = matches[0]
    if (!(element instanceof HTMLElement)) throw new Error('Control is unavailable')
    if (element.closest('[data-studio-human-only]'))
      throw new Error('This control requires human review')
    if (element.matches(':disabled')) throw new Error('Control is disabled')
    if (command.action === 'click') element.click()
    else {
      if (
        !(
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement
        )
      )
        throw new Error('Choose an input, textarea or select')
      if (element instanceof HTMLInputElement && ['password', 'file'].includes(element.type))
        throw new Error('Use Studio directly for passwords and file uploads')
      if (element instanceof HTMLSelectElement) element.value = command.text
      else {
        const prototype =
          element instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, command.text)
      }
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }
  }
  return { ok: true }
}
