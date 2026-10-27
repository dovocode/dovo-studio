import { useEffect, useRef, type RefObject } from 'react'

const panels = '[data-approval-id], form[aria-label="Agent questions"]'
const editable =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="menu"], [role="listbox"]'

/** Resolve focused input first; an unscoped shortcut needs a single visible request. */
export function humanInputShortcutTarget(event: KeyboardEvent): HTMLElement | null {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    !(event.target instanceof Element) ||
    event.target.closest(editable)
  )
    return null
  const focused = event.target.closest<HTMLElement>(panels)
  const visible = (element: HTMLElement) => element.getClientRects().length > 0
  const requests = [...document.querySelectorAll<HTMLElement>(panels)].filter(visible)
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
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [root, disabled, onAnswer])
}
