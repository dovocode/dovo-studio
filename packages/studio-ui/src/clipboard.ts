declare global {
  interface Window {
    /** Trusted Studio preload only; websites do not receive this bridge. */
    dovoCopyText?: (text: string) => Promise<void>
  }
}

/** Clipboard API needs a secure context; the selection fallback also supports LAN HTTP. */
export async function copyTextToClipboard(text: string) {
  // Native views can hold OS focus while a Studio action finishes loading its text.
  if (window.dovoCopyText) {
    await window.dovoCopyText(text)
    return
  }
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // A denied modern API can still permit copying an explicit user selection.
    }
  }
  const active = document.activeElement
  const inputSelection =
    active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
      ? {
          start: active.selectionStart,
          end: active.selectionEnd,
          direction: active.selectionDirection,
        }
      : null
  const selection = document.getSelection()
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) =>
        selection.getRangeAt(index).cloneRange(),
      )
    : []
  const input = document.createElement('textarea')
  input.value = text
  input.readOnly = true
  input.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0'
  // Keep the fallback inside a modal's focus trap, including context/dropdown menus.
  const parent = active?.closest('[role=dialog], [role=alertdialog], [role=menu]') ?? document.body
  parent.append(input)
  try {
    input.focus({ preventScroll: true })
    input.select()
    if (!document.execCommand('copy'))
      throw new Error(
        'Could not copy. Select the text and copy it manually, or download the source.',
      )
  } finally {
    input.remove()
    if (active instanceof HTMLElement) active.focus({ preventScroll: true })
    if (selection) {
      selection.removeAllRanges()
      for (const range of ranges) selection.addRange(range)
    }
    if (
      inputSelection?.start !== null &&
      inputSelection?.start !== undefined &&
      inputSelection.end !== null &&
      (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)
    )
      active.setSelectionRange(
        inputSelection.start,
        inputSelection.end,
        inputSelection.direction ?? undefined,
      )
  }
}
