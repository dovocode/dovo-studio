/** Serialized by Playwright into each document, including cross-origin frames. */
export function browserInteraction() {
  let target: Element | undefined
  let scheduled = false
  let previous = ''
  const editable = (element: Element | null) =>
    (element instanceof HTMLInputElement &&
      !element.disabled &&
      !element.readOnly &&
      ['text', 'search', 'tel', 'url', 'email', 'password', 'number'].includes(element.type)) ||
    (element instanceof HTMLTextAreaElement && !element.disabled && !element.readOnly) ||
    (element instanceof HTMLElement && element.isContentEditable)
  const publish = () => {
    scheduled = false
    const element = target?.isConnected ? target : undefined
    const link = element?.closest('a[href]')
    const href = link instanceof HTMLAnchorElement ? link.href : ''
    const cursor = element ? getComputedStyle(element).cursor : 'auto'
    const value = {
      type: 'interaction',
      cursor: cursor.includes('url(')
        ? 'auto'
        : cursor === 'auto' && editable(element ?? null)
          ? 'text'
          : cursor,
      href: href.slice(0, 4096),
      editable: editable(document.activeElement),
    }
    const encoded = JSON.stringify(value)
    if (encoded === previous) return
    previous = encoded
    // A page can call its exposed binding too. The host treats every value as
    // untrusted metadata, validates it, and never evaluates it in the viewer.
    const binding: unknown = Reflect.get(window, '__dovoBrowserInteraction')
    if (typeof binding === 'function') void binding(value)
  }
  addEventListener(
    'pointermove',
    (event) => {
      target = event.composedPath().find((item): item is Element => item instanceof Element)
      if (!scheduled) {
        scheduled = true
        requestAnimationFrame(publish)
      }
    },
    { passive: true },
  )
  addEventListener('pageshow', publish)
  addEventListener('focusin', publish)
  addEventListener('focusout', () => queueMicrotask(publish))
  addEventListener(
    'pointerout',
    (event) => {
      if (event.relatedTarget) return
      target = undefined
      publish()
    },
    { passive: true },
  )
  publish()
}
