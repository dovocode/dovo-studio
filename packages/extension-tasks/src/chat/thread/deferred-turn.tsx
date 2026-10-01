import { useEffect, useRef, useState, type ReactNode } from 'react'

const listeners = new Map<Element, () => void>()
let observer: IntersectionObserver | undefined
function observe(element: Element, reveal: () => void) {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) if (entry.isIntersecting) listeners.get(entry.target)?.()
    },
    { rootMargin: '800px 0px' },
  )
  listeners.set(element, reveal)
  observer.observe(element)
  return () => {
    listeners.delete(element)
    observer?.unobserve(element)
    if (!listeners.size) {
      observer?.disconnect()
      observer = undefined
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
  const element = useRef<HTMLDivElement>(null)
  const [visited, setVisited] = useState(immediate)
  useEffect(() => {
    if (immediate && !visited) {
      setVisited(true)
      return
    }
    if (visited || !element.current) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisited(true)
      return
    }
    return observe(element.current, () => setVisited(true))
  }, [visited, immediate])
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
