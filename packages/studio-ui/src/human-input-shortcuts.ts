import { useEffect, useRef, type RefObject } from 'react'

const panels = '[data-approval-id], form[aria-label="Agent questions"]'
const editable =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="menu"], [role="listbox"]'

function emptyComposer(event: KeyboardEvent, target: Element) {
  if (event.key !== 'Enter' || event.shiftKey) return null
  const composer = target.closest<HTMLElement>(
    'textarea[data-task-id], [role="textbox"][contenteditable="true"][data-task-id]',
  )
  if (
    !composer ||
    composer.getAttribute('aria-readonly') === 'true' ||
    composer.getAttribute('aria-disabled') === 'true'
  )
    return null
  if (composer instanceof HTMLTextAreaElement)
    return !composer.disabled && !composer.readOnly && !composer.value.trim() ? composer : null
  // The rich editor knows whether its document has any content, including non-text nodes.
  return composer.hasAttribute('data-empty') ? composer : null
}

/** Resolve focused input first; an unscoped shortcut needs a single visible request. */
export function humanInputShortcutTarget(event: KeyboardEvent): HTMLElement | null {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    !(event.target instanceof Element)
  )
    return null
  const composer = emptyComposer(event, event.target)
  if (event.target.closest(editable) && !composer) return null
  const focused = event.target.closest<HTMLElement>(panels)
  const visible = (element: HTMLElement) => element.getClientRects().length > 0
  const pane = composer?.closest('[data-task-conversation]')
  const requests = [...document.querySelectorAll<HTMLElement>(panels)].filter(
    (panel) =>
      visible(panel) &&
      (!composer ||
        (panel.closest<HTMLElement>('[data-human-input-task]')?.dataset.humanInputTask ===
          composer.dataset.taskId &&
          (!pane || pane.contains(panel)))),
  )
  const panel = focused ?? (requests.length === 1 ? requests[0] : undefined)
  if (!panel || !visible(panel)) return null
  // An unrelated modal owns the keyboard until it closes.
  if (
    [...document.querySelectorAll<HTMLElement>('[role="dialog"], dialog[open]')].some(
      (dialog) => visible(dialog) && !dialog.contains(panel),
    )
  )
    return null
  return panel
}

export function useApprovalShortcuts({
  root,
  disabled,
  onAnswer,
}: {
  root: RefObject<HTMLElement | null>
  disabled: boolean
  onAnswer: (id: string, allow: boolean) => void | Promise<unknown>
}) {
  const pending = useRef(false)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (disabled || pending.current) return
      const key = event.key.toLowerCase()
      if (key !== 'y' && key !== 'n' && key !== 'enter') return
      if (
        key === 'enter' &&
        (event.shiftKey ||
          (event.target instanceof Element &&
            event.target.closest('button, a, summary, [role="button"]')))
      )
        return
      const panel = humanInputShortcutTarget(event)
      const id = panel?.dataset.approvalId
      if (!id || !root.current?.contains(panel)) return
      event.preventDefault()
      pending.current = true
      void Promise.resolve(onAnswer(id, key !== 'n')).finally(() => {
        pending.current = false
      })
    }
    // Empty-composer Enter must reach the request before the editor consumes the key.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [root, disabled, onAnswer])
}
