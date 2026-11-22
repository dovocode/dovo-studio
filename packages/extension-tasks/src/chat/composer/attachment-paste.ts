export function pasteAttachmentFiles(clipboard: DataTransfer, files: readonly File[]) {
  if (!files.length) return false
  const text = clipboard.getData('text/plain').trim()
  if (!text) return true
  if (!files.some((file) => file.type.startsWith('image/'))) return false
  const names = new Set(files.map((file) => file.name))
  if (
    text
      .split(/\r?\n/)
      .filter(Boolean)
      .every((line) => names.has(line))
  )
    return true

  // Browsers can include the image URL as text with Copy Image. A template keeps HTML inert.
  const html = clipboard.getData('text/html')
  if (!html) return false
  const template = document.createElement('template')
  template.innerHTML = html
  return (
    !template.content.textContent?.trim() &&
    Array.from(template.content.querySelectorAll('img')).some(
      (image) => image.getAttribute('src') === text,
    )
  )
}
