import { useEffect, useRef, type RefObject } from 'react'

const panels = '[data-approval-id], form[aria-label="Agent questions"]'
const editable =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="menu"], [role="listbox"]'

/** Shortcuts belong only to the request that currently holds keyboard focus. */
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
  if (!document.hasFocus() || event.target !== document.activeElement) return null
  if (event.target.closest(editable)) return null
  const panel = event.target.closest<HTMLElement>(panels)
  const visible = (element: HTMLElement) => element.getClientRects().length > 0
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
    // Capture shortcuts only after the user focuses a request.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [root, disabled, onAnswer])
}
