import { useConversationHistory } from '@dovo/studio-ui'
import { useEffect, useRef, useState, type ReactNode } from 'react'

const observers = new WeakMap<
  Element,
  { observer: IntersectionObserver; listeners: Map<Element, () => void> }
>()
function observe(element: Element, root: Element, reveal: () => void) {
  let shared = observers.get(root)
  if (!shared) {
    const listeners = new Map<Element, () => void>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) listeners.get(entry.target)?.()
      },
      { root, rootMargin: '800px 0px' },
    )
    shared = { observer, listeners }
    observers.set(root, shared)
  }
  const { observer, listeners } = shared
  listeners.set(element, reveal)
  observer.observe(element)
  return () => {
    listeners.delete(element)
    observer.unobserve(element)
    if (!listeners.size) {
      observer.disconnect()
      observers.delete(root)
    }
  }
}

/** Off-screen CSS skips layout, but this also skips building old Markdown and tool trees. */
export function DeferredTurn({
  immediate,
  children,
}: {
  immediate: boolean
  children: () => ReactNode
}) {
  const { ready, scrollRef } = useConversationHistory()
  const element = useRef<HTMLDivElement>(null)
  const [visited, setVisited] = useState(immediate)
  useEffect(() => {
    if (immediate && !visited) {
      setVisited(true)
      return
    }
    if (visited || !ready || !element.current || !scrollRef.current) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisited(true)
      return
    }
    return observe(element.current, scrollRef.current, () => setVisited(true))
  }, [visited, immediate, ready, scrollRef])
  return (
    <div
      ref={element}
      className="flex min-w-0 flex-col gap-3"
      style={visited || immediate ? undefined : { minHeight: 240 }}
    >
      {visited || immediate ? children() : null}
    </div>
  )
}
