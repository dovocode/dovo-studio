import { useCallback, useEffect, useId, useRef, type CSSProperties } from 'react'
import { flushSync } from 'react-dom'

/** Snapshot only the detail pane; its live DOM and navigation never wait for an exit animation. */
export function useDetailTransition() {
  const id = useId()
  const active = useRef<ViewTransition | null>(null)
  const generation = useRef(0)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    const motion = matchMedia('(prefers-reduced-motion: reduce)')
    const stop = () => active.current?.skipTransition()
    motion.addEventListener('change', stop)
    return () => {
      mounted.current = false
      generation.current++
      stop()
      motion.removeEventListener('change', stop)
    }
  }, [])
  const transition = useCallback((update: () => void, direction: 'open' | 'close' = 'open') => {
    const current = ++generation.current
    active.current?.skipTransition()
    if (
      document.visibilityState !== 'visible' ||
      matchMedia('(prefers-reduced-motion: reduce)').matches ||
      !document.startViewTransition ||
      !CSS.supports('view-transition-class: studio-detail-panel') ||
      !CSS.supports('selector(:active-view-transition-type(studio-detail))')
    ) {
      update()
      return
    }
    const next = document.startViewTransition({
      types: ['studio-detail', `studio-detail-${direction}`],
      update: () => {
        if (mounted.current && generation.current === current) flushSync(update)
      },
    })
    active.current = next
    // Skipping an interrupted animation rejects ready with AbortError. Surface other
    // failures, including navigation errors, instead of silently dropping them.
    void Promise.allSettled([next.ready, next.finished]).then((results) => {
      if (active.current === next) active.current = null
      for (const result of results) {
        if (result.status !== 'rejected') continue
        const error: unknown = result.reason
        if (error instanceof DOMException && error.name === 'AbortError') continue
        reportError(error)
        break
      }
    })
  }, [])
  const style: CSSProperties = { viewTransitionName: `studio-detail-${id.replace(/:/g, '')}` }
  return { transition, style }
}
