import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { PullDetail } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'

/** Files mount within this distance of the scrolled viewport... */
const mountMargin = 1000
/** ...and release their diff trees beyond this one. */
const retainMargin = 3000

type SharedObserver = {
  observer: IntersectionObserver
  listeners: Map<Element, (entry: IntersectionObserverEntry) => void>
}
const observers = new WeakMap<Element | Document, Map<number, SharedObserver>>()
function observe(
  element: Element,
  root: Element | null,
  margin: number,
  listener: (entry: IntersectionObserverEntry) => void,
) {
  const key = root ?? document
  let byMargin = observers.get(key)
  if (!byMargin) {
    byMargin = new Map()
    observers.set(key, byMargin)
  }
  let shared = byMargin.get(margin)
  if (!shared) {
    const listeners = new Map<Element, (entry: IntersectionObserverEntry) => void>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) listeners.get(entry.target)?.(entry)
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

function scrollParent(element: Element) {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent)
    if (overflowY === 'auto' || overflowY === 'scroll') return parent
  }
  return null
}

function selectionWithin(element: Element) {
  const selection = document.getSelection()
  if (!selection || selection.isCollapsed) return false
  for (let index = 0; index < selection.rangeCount; index++)
    if (selection.getRangeAt(index).intersectsNode(element)) return true
  return false
}

/**
 * Mount expensive diffs near the viewport and release them far away at their measured height.
 * A pinned file (selected, or holding a comment draft), focus and selected text stay mounted.
 */
export function DeferredPullFile({
  file,
  pinned,
  heights,
  children,
}: {
  file: PullDetail['files'][number]
  pinned: boolean
  /** Last rendered diff heights by path, owned by the file list. */
  heights: Map<string, number>
  children: ReactNode
}) {
  const container = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  const [held, setHeld] = useState(false)
  const [expanded, setExpanded] = useState<boolean | null>(null)
  // Removing a focused control fires no blur, so check that it is still the active element.
  const focused = useRef<EventTarget | null>(null)
  const hasFocus = () => !!focused.current && focused.current === document.activeElement
  const reason = file.attributes?.generated
    ? 'Generated file'
    : file.attributes?.vendored
      ? 'Vendored file'
      : ''
  const collapsed = !!reason && !(expanded ?? false)
  // Generated and vendored files load only after the reader expands them once.
  // Keep focus or selected text through the commit that removes an off-screen pin.
  const interacting =
    !pinned && !near && !!container.current && (hasFocus() || selectionWithin(container.current))
  const mounted = (!collapsed || expanded !== null) && (pinned || near || held || interacting)
  const rendered = useRef(mounted)
  useLayoutEffect(() => {
    rendered.current = mounted
  }, [mounted])
  const hold = () => {
    const target = container.current
    if (target && (hasFocus() || selectionWithin(target))) setHeld(true)
  }
  useEffect(() => {
    const target = container.current
    if (!target) return
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    const root = scrollParent(target)
    const enter = observe(target, root, mountMargin, (entry) => {
      if (!entry.isIntersecting) return
      setNear(true)
      setHeld(false)
    })
    const leave = observe(target, root, retainMargin, (entry) => {
      // A hidden tab reports no intersection; keep its diffs for the reader's return.
      if (entry.isIntersecting || !target.getClientRects().length) return
      hold()
      setNear(false)
    })
    return () => {
      enter()
      leave()
    }
  }, [])
  useEffect(() => {
    if (!pinned && !near) hold()
  }, [pinned])
  useEffect(() => {
    const target = container.current
    if (!held || !target) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const release = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (!hasFocus() && !selectionWithin(target)) setHeld(false)
      })
    }
    // A removed control blurs silently; the reader's next interaction re-checks the hold.
    const events = ['selectionchange', 'focusin', 'focusout', 'pointerdown'] as const
    for (const event of events) document.addEventListener(event, release)
    return () => {
      clearTimeout(timer)
      for (const event of events) document.removeEventListener(event, release)
    }
  }, [held])
  useEffect(() => {
    const target = content.current
    if (!target || typeof ResizeObserver === 'undefined') return
    let previous = 0
    const observer = new ResizeObserver(([entry]) => {
      const height = entry?.borderBoxSize?.[0]?.blockSize ?? target.offsetHeight
      if (!height) return
      if (rendered.current) heights.set(file.path, height)
      const delta = previous ? height - previous : 0
      previous = height
      const root = scrollParent(target)
      if (!delta || !root || getComputedStyle(root).overflowAnchor === 'auto') return
      // Without native scroll anchoring, keep the reader in place when an earlier diff resizes.
      if (target.getBoundingClientRect().bottom <= root.getBoundingClientRect().top + 1)
        root.scrollTop += delta
    })
    observer.observe(target)
    return () => observer.disconnect()
  }, [heights, file.path])
  const height = heights.get(file.path)
  return (
    <div
      ref={container}
      onFocus={(event) => {
        focused.current = event.target
      }}
      onBlur={() => {
        focused.current = null
      }}
    >
      {reason && (
        <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
          <span>{reason} · marked in .gitattributes</span>
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={!collapsed}
            onClick={() => {
              setExpanded(collapsed)
              if (collapsed) setNear(true)
            }}
          >
            {collapsed ? 'Show changes' : 'Hide changes'}
          </Button>
        </div>
      )}
      {/* One persistent element keeps the measured height across mounting. */}
      <div
        ref={content}
        hidden={collapsed}
        className={
          mounted
            ? undefined
            : height
              ? 'flex items-center justify-center'
              : 'flex min-h-40 items-center justify-center py-4'
        }
        style={!mounted && height ? { height } : undefined}
      >
        {mounted ? (
          children
        ) : collapsed ? null : (
          <Button size="sm" variant="ghost" onClick={() => setNear(true)}>
            Load changes for {file.path}
          </Button>
        )}
      </div>
    </div>
  )
}
