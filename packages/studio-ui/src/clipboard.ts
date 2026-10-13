/** Clipboard API needs a secure context; the selection fallback also supports LAN HTTP. */
export async function copyTextToClipboard(text: string) {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // A denied modern API can still permit copying an explicit user selection.
    }
  }
  const active = document.activeElement
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
  document.body.append(input)
  try {
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
  }
}
