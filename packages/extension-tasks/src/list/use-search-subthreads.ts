import { useEffect, useState } from 'react'

/** A temporary search reveal. Never change saved expansion choices. */
export function useSearchSubthreads(active: boolean) {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (!active) return
    const update = (event: KeyboardEvent) =>
      setHeld(event.altKey && !event.ctrlKey && !event.metaKey)
    const reset = () => setHeld(false)
    window.addEventListener('keydown', update, true)
    window.addEventListener('keyup', update, true)
    window.addEventListener('blur', reset)
    document.addEventListener('visibilitychange', reset)
    return () => {
      window.removeEventListener('keydown', update, true)
      window.removeEventListener('keyup', update, true)
      window.removeEventListener('blur', reset)
      document.removeEventListener('visibilitychange', reset)
      reset()
    }
  }, [active])
  return active && held
}
