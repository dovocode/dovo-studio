import { useConversationHistory } from '@dovo/studio-ui'
import { useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { TurnWindowContext } from './turn-window'

/** Turns mount within this distance of the viewport... */
const mountMargin = 1200
/** ...and unmount beyond this one, so small scrolls never rebuild a turn. */
const retainMargin = 3600
const estimatedHeight = 240

type SharedObserver = {
  observer: IntersectionObserver
  listeners: Map<Element, (near: boolean) => void>
}
const observers = new WeakMap<Element, Map<number, SharedObserver>>()
function observe(
  element: Element,
  root: Element,
  margin: number,
  listener: (near: boolean) => void,
) {
  let byMargin = observers.get(root)
  if (!byMargin) {
    byMargin = new Map()
    observers.set(root, byMargin)
  }
  let shared = byMargin.get(margin)
  if (!shared) {
    const listeners = new Map<Element, (near: boolean) => void>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting)
      },
      { root, rootMargin: `${margin}px 0px` },
    )
    shared = { observer, listeners }
    byMargin.set(margin, shared)
  }
  const { observer, listeners } = shared
  listeners.set(element, listener)
  observer.observe(element)
  return () => {
    listeners.delete(element)
    observer.unobserve(element)
    if (!listeners.size) {
      observer.disconnect()
      byMargin.delete(margin)
    }
  }
}

function selectionWithin(element: Element) {
  const selection = document.getSelection()
  if (!selection || selection.isCollapsed) return false
  for (let index = 0; index < selection.rangeCount; index++)
    if (selection.getRangeAt(index).intersectsNode(element)) return true
  return false
}

/**
 * Builds a turn's Markdown and tool trees only near the viewport and releases them again far
 * away, keeping the last measured height. Pinned turns, focus, selected text and detached previews
 * stay mounted.
 */
export function DeferredTurn({
  id,
  pinned,
  children,
}: {
  id: string
  pinned: boolean
  children: () => ReactNode
}) {
  const { ready, scrollRef } = useConversationHistory()
  const turns = useContext(TurnWindowContext)
  const element = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(pinned)
  const [held, setHeld] = useState(false)
  // Removing a focused control fires no blur, so check that it is still the active element.
  const focused = useRef<EventTarget | null>(null)
  const hasFocus = () => !!focused.current && focused.current === document.activeElement
  const hasInteraction = (target: Element) =>
    hasFocus() || selectionWithin(target) || !!target.querySelector('[data-preview-overlay="true"]')
  // A pin can be removed before the observer runs. Preserve interaction during that commit;
  // the effect below then records the hold before any focused or selected content disappears.
  const interacting = !pinned && !near && !!element.current && hasInteraction(element.current)
  const mounted = pinned || near || held || interacting
  const rendered = useRef(mounted)
  useLayoutEffect(() => {
    rendered.current = mounted
    turns?.setMounted(id, mounted)
  }, [turns, id, mounted])
  useEffect(() => () => turns?.setMounted(id, false), [turns, id])
  const hold = () => {
    const target = element.current
    if (target && hasInteraction(target)) setHeld(true)
  }
  useEffect(() => {
    const target = element.current
    const root = scrollRef.current
    if (!ready || !target || !root) return
    if (turns) turns.scrollRoot = root
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    const enter = observe(target, root, mountMargin, (inside) => {
      if (!inside) return
      setNear(true)
      setHeld(false)
    })
    const leave = observe(target, root, retainMargin, (inside) => {
      // A hidden thread reports no intersection; keep its turns for the reader's return.
      if (inside || !target.getClientRects().length) return
      hold()
      setNear(false)
    })
    return () => {
      enter()
      leave()
    }
  }, [ready, scrollRef, turns])
  // A turn unpinned while far away (a finished search jump) still keeps the reader's focus.
  useEffect(() => {
    if (!pinned && !near) hold()
  }, [pinned])
  useEffect(() => {
    const target = element.current
    if (!held || !target) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const release = () => {
      clearTimeout(timer)
      // Focus moving between two controls blurs before it lands.
      timer = setTimeout(() => {
        if (!hasInteraction(target)) setHeld(false)
      })
    }
    // A removed control blurs silently; the reader's next interaction re-checks the hold.
    const events = ['selectionchange', 'focusin', 'focusout', 'pointerdown'] as const
    for (const event of events) document.addEventListener(event, release)
    // Docking or closing a preview can release a turn without moving focus.
    const observer = new MutationObserver(release)
    observer.observe(target, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-preview-overlay'],
    })
    return () => {
      clearTimeout(timer)
      for (const event of events) document.removeEventListener(event, release)
      observer.disconnect()
    }
  }, [held])
  useEffect(() => {
    const target = element.current
    const root = scrollRef.current
    if (!target || typeof ResizeObserver === 'undefined') return
    let previous = 0
    const observer = new ResizeObserver(([entry]) => {
      const height = entry?.borderBoxSize?.[0]?.blockSize ?? target.offsetHeight
      // Content-visibility skips layout off-screen; ignore its empty measurements.
      if (!height) return
      if (rendered.current) turns?.heights.set(id, height)
      const delta = previous ? height - previous : 0
      previous = height
      if (!delta || !root || getComputedStyle(root).overflowAnchor === 'auto') return
      // Without native scroll anchoring, keep the reader in place when an earlier turn resizes.
      if (target.getBoundingClientRect().bottom <= root.getBoundingClientRect().top + 1)
        root.scrollTop += delta
    })
    observer.observe(target)
    return () => observer.disconnect()
  }, [turns, id, scrollRef])
  return (
    <div
      ref={element}
      className="flex min-w-0 flex-col gap-3"
      style={mounted ? undefined : { height: turns?.heights.get(id) ?? estimatedHeight }}
      onFocus={(event) => {
        focused.current = event.target
        if (!mounted) setNear(true)
      }}
      onBlur={() => {
        focused.current = null
      }}
      // Keyboard navigation can reach an unloaded turn and load it in place.
      tabIndex={mounted ? undefined : 0}
      role={mounted ? undefined : 'group'}
      aria-label={mounted ? undefined : 'Turn not loaded. Focus to load it.'}
    >
      {mounted ? children() : null}
    </div>
  )
}
