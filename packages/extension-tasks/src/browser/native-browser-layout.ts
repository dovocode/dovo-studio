const floatingOverlays =
  'dialog[open], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="tooltip"], .studio-tooltip, [data-preview-dragging="true"], [data-inline-artifact] [data-preview-overlay="true"]'
const overlays = `details[open], ${floatingOverlays}`

/** Streaming in another pane cannot move this browser. Portalled overlays can. */
export function observeNativeBrowserLayout(slot: HTMLElement, schedule: () => void) {
  const root = slot.closest('[data-native-browser-layout]') ?? slot
  const beforeStyle = document.createElement('div').style
  const afterStyle = document.createElement('div').style
  const relevant = (records: MutationRecord[]) =>
    records.some((record) => {
      const target = record.target
      if (!(target instanceof Element)) return false
      if (record.attributeName === 'style' && target.contains(root)) {
        beforeStyle.cssText = record.oldValue ?? ''
        afterStyle.cssText = target.getAttribute('style') ?? ''
        beforeStyle.removeProperty('clip-path')
        afterStyle.removeProperty('clip-path')
        if (beforeStyle.cssText === afterStyle.cssText) return false
      }
      if (root.contains(target) || target.contains(root) || target.closest(floatingOverlays))
        return true
      if (record.type === 'attributes')
        return (
          target.matches('details, dialog') ||
          !!target.querySelector(floatingOverlays) ||
          ['role', 'aria-modal', 'data-preview-dragging', 'data-preview-overlay'].includes(
            record.attributeName ?? '',
          ) ||
          (record.attributeName === 'class' &&
            !!record.oldValue?.split(/\s+/).includes('studio-tooltip'))
        )
      return [...record.addedNodes, ...record.removedNodes].some(
        (node) =>
          node instanceof Element &&
          (node.contains(root) || node.matches(overlays) || !!node.querySelector(overlays)),
      )
    })
  const resize = new ResizeObserver(schedule)
  resize.observe(slot)
  if (root !== slot) resize.observe(root)
  const mutations = new MutationObserver((records) => {
    if (relevant(records)) schedule()
  })
  mutations.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: [
      'open',
      'hidden',
      'style',
      'class',
      'role',
      'aria-modal',
      'data-state',
      'data-preview-dragging',
      'data-preview-overlay',
    ],
  })
  window.addEventListener('resize', schedule)
  window.addEventListener('scroll', schedule, true)
  return () => {
    resize.disconnect()
    mutations.disconnect()
    window.removeEventListener('resize', schedule)
    window.removeEventListener('scroll', schedule, true)
  }
}

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
    // A floating preview escapes the browser pane's scrolling/clipping containers.
    if (parent.matches('[data-preview-overlay="true"]') && style.position === 'fixed') break
  }
  if (right - left < 1 || bottom - top < 1) return
  return new DOMRect(left, top, right - left, bottom - top)
}

export function nativeBrowserOcclusion(slot: HTMLElement, rect: DOMRect) {
  let occlusion: 'tooltip' | 'overlay' | undefined
  // Backdrops can cover the browser even when their dialog sits elsewhere.
  const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
  if (hit && hit !== document.body && hit !== document.documentElement && !slot.contains(hit))
    occlusion = hit.closest('[role="tooltip"], .studio-tooltip') ? 'tooltip' : 'overlay'
  if (occlusion === 'overlay') return occlusion
  for (const element of document.querySelectorAll<HTMLElement>(overlays)) {
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
    // Text-only tips deliberately ignore pointer events. Hit testing cannot see them,
    // but their painted bounds still cover the native page.
    if (
      element.matches('.studio-tooltip, [role="tooltip"]') &&
      getComputedStyle(element).pointerEvents === 'none'
    ) {
      occlusion = 'tooltip'
      continue
    }
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
    if (!element.matches('[role="tooltip"], .studio-tooltip')) return 'overlay'
    occlusion = 'tooltip'
  }
  return occlusion
}

function subtractRect(rect: DOMRect, cover: DOMRect): DOMRect[] {
  const left = Math.max(rect.left, cover.left)
  const right = Math.min(rect.right, cover.right)
  const top = Math.max(rect.top, cover.top)
  const bottom = Math.min(rect.bottom, cover.bottom)
  if (left >= right || top >= bottom) return [rect]
  return [
    new DOMRect(rect.left, rect.top, rect.width, top - rect.top),
    new DOMRect(rect.left, bottom, rect.width, rect.bottom - bottom),
    new DOMRect(rect.left, top, left - rect.left, bottom - top),
    new DOMRect(right, top, rect.right - right, bottom - top),
  ].filter((part) => part.width > 0 && part.height > 0)
}

const holes = new WeakMap<
  HTMLElement,
  {
    previous: string
    applied: string
    rects: Map<symbol, DOMRect[]>
  }
>()

/** Leave native page slots transparent. Keep inline menus painted, as well as body portals. */
export function nativeBrowserHole(slot?: HTMLElement | null) {
  const appRoot = document.getElementById('root')
  const root =
    slot && !appRoot?.contains(slot)
      ? (slot.closest<HTMLElement>('[data-preview-overlay]') ?? appRoot)
      : appRoot
  const key = Symbol()
  const paint = () => {
    if (!root) return
    const state = holes.get(root)
    if (!state) return
    // Overlapping panes must cut one hole, not cancel each other under the evenodd rule.
    const rects: DOMRect[] = []
    for (const rect of [...state.rects.values()].flat()) {
      let parts = [rect]
      for (const existing of rects) parts = parts.flatMap((part) => subtractRect(part, existing))
      rects.push(...parts)
    }
    const bounds = root.getBoundingClientRect()
    const paths = rects.map((rect) => {
      const left = rect.left - bounds.left,
        top = rect.top - bounds.top
      const right = rect.right - bounds.left,
        bottom = rect.bottom - bounds.top
      return `${left}px ${top}px, ${right}px ${top}px, ${right}px ${bottom}px, ${left}px ${bottom}px, ${left}px ${top}px, 0px 0px`
    })
    const next = paths.length
      ? `polygon(evenodd, 0px 0px, ${bounds.width}px 0px, ${bounds.width}px ${bounds.height}px, 0px ${bounds.height}px, 0px 0px, ${paths.join(', ')})`
      : state.previous
    if (root.style.clipPath !== next) root.style.clipPath = next
    // CSS serializes fractional coordinates with less precision. Keep the applied
    // value so hit testing and cleanup recognize the clip that we own.
    state.applied = root.style.clipPath
    if (!state.rects.size) holes.delete(root)
  }
  return {
    occlusion(rect: DOMRect) {
      if (!slot) return
      const state = root ? holes.get(root) : undefined
      const current = root?.style.clipPath
      const unclipped = !!(root && state && current === state.applied)
      // Hit-test the real UI, not the transparent hole we painted last frame. This
      // matters for floating previews: their hole exposes a different pane below.
      if (unclipped && root && state) root.style.clipPath = state.previous
      try {
        return nativeBrowserOcclusion(slot, rect)
      } finally {
        if (unclipped && root && current !== undefined) root.style.clipPath = current
      }
    },
    update(rect: DOMRect | undefined) {
      if (!root) return
      let state = holes.get(root)
      if (!state && !rect) return
      if (!state) {
        state = { previous: root.style.clipPath, applied: '', rects: new Map() }
        holes.set(root, state)
      }
      if (rect) {
        const previous = root.style.clipPath
        if (previous !== state.previous) root.style.clipPath = state.previous
        let partsResult: DOMRect[]
        try {
          let parts = [rect]
          for (const element of root.querySelectorAll<HTMLElement>(overlays)) {
            if (
              (slot && element.contains(slot)) ||
              !element.checkVisibility({ visibilityProperty: true })
            )
              continue
            const cover = element.getBoundingClientRect()
            parts = parts.flatMap((part) => subtractRect(part, cover))
          }
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
          // An unknown inline panel must remain visible until it has an explicit overlay role.
          if (slot && hit && root.contains(hit) && !slot.contains(hit) && !hit.closest(overlays))
            parts = []
          partsResult = parts
        } finally {
          if (root.style.clipPath !== previous) root.style.clipPath = previous
        }
        state.rects.set(key, partsResult)
      } else state.rects.delete(key)
      paint()
    },
    dispose() {
      if (!root) return
      const state = holes.get(root)
      if (!state) return
      state.rects.delete(key)
      if (root.style.clipPath === state.applied) paint()
    },
  }
}
