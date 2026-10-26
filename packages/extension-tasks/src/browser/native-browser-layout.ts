/** Native views must fit the visible slot, including its scrolling/clipping containers. */
export function nativeBrowserBounds(slot: HTMLElement) {
  if (!slot.checkVisibility({ visibilityProperty: true })) return
  const box = slot.getBoundingClientRect()
  let left = Math.max(0, box.left)
  let top = Math.max(0, box.top)
  let right = Math.min(innerWidth, box.right)
  let bottom = Math.min(innerHeight, box.bottom)
  for (let parent = slot.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent)
    const bounds = parent.getBoundingClientRect()
    if (/^(auto|scroll|hidden|clip)$/.test(style.overflowX)) {
      left = Math.max(left, bounds.left + parent.clientLeft)
      right = Math.min(right, bounds.left + parent.clientLeft + parent.clientWidth)
    }
    if (/^(auto|scroll|hidden|clip)$/.test(style.overflowY)) {
      top = Math.max(top, bounds.top + parent.clientTop)
      bottom = Math.min(bottom, bounds.top + parent.clientTop + parent.clientHeight)
    }
  }
  if (right - left < 1 || bottom - top < 1) return
  return new DOMRect(left, top, right - left, bottom - top)
}

export function nativeBrowserOcclusion(slot: HTMLElement, rect: DOMRect) {
  let occlusion: 'tooltip' | 'overlay' | undefined
  // Backdrops can cover the browser even when their dialog sits elsewhere.
  const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
  if (hit && hit !== document.body && hit !== document.documentElement && !slot.contains(hit))
    occlusion = hit.closest('[role="tooltip"]') ? 'tooltip' : 'overlay'
  if (occlusion === 'overlay') return occlusion
  for (const element of document.querySelectorAll<HTMLElement>(
    'details[open], dialog[open], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="tooltip"], [data-preview-dragging="true"], [data-inline-artifact] [data-preview-overlay="true"]',
  )) {
    if (
      (element.contains(slot) && !element.matches('[data-preview-dragging="true"]')) ||
      !element.checkVisibility({ visibilityProperty: true })
    )
      continue
    const overlay = element.getBoundingClientRect()
    if (!overlay.width || !overlay.height) continue
    if (element.matches('dialog[open], [aria-modal="true"]')) return 'overlay'
    const left = Math.max(rect.left, overlay.left)
    const right = Math.min(rect.right, overlay.right)
    const top = Math.max(rect.top, overlay.top)
    const bottom = Math.min(rect.bottom, overlay.bottom)
    if (right <= left || bottom <= top) continue
    if (element.matches('[data-preview-dragging="true"]') && element.contains(slot))
      return 'overlay'
    // Open disclosures and persistent panels underneath floating previews are not overlays.
    const above = [
      [(left + right) / 2, (top + bottom) / 2],
      [left + 0.5, top + 0.5],
      [right - 0.5, top + 0.5],
      [left + 0.5, bottom - 0.5],
      [right - 0.5, bottom - 0.5],
    ].some(([x, y]) => {
      const hit = document.elementFromPoint(x, y)
      return hit !== null && element.contains(hit)
    })
    if (!above) continue
    if (!element.matches('[role="tooltip"]')) return 'overlay'
    occlusion = 'tooltip'
  }
  return occlusion
}
