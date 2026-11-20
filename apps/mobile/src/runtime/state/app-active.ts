import { useEffect, useRef, useSyncExternalStore } from 'react'
import { AppState } from 'react-native'

const subscribe = (notify: () => void) => {
  const subscription = AppState.addEventListener('change', notify)
  return () => subscription.remove()
}
const active = () => AppState.currentState === 'active'

/** Timers belong to visible UI; push notifications handle background changes. */
export function useAppActive() {
  return useSyncExternalStore(subscribe, active, active)
}

export function useForegroundInterval(callback: () => void, interval: number | null) {
  const latest = useRef(callback)
  latest.current = callback
  const foreground = useAppActive()
  useEffect(() => {
    if (!foreground || interval === null) return
    latest.current()
    const timer = setInterval(() => latest.current(), interval)
    return () => clearInterval(timer)
  }, [foreground, interval])
}

/** iOS reports `inactive` for Face ID, Control Center, the app switcher and permission prompts.
 * Connections and network polling keep their state until the app reaches the background. */
export function nextAppForeground(previous: boolean, state: string | null | undefined) {
  if (state === 'active') return true
  if (state === 'background') return false
  return previous
}

/** Calls `listener` when the app returns from the background. A return from `inactive` is not a
 * resume, so a Face ID prompt does not start a new burst of requests. */
export function subscribeAppResume(listener: () => void) {
  let foreground = nextAppForeground(false, AppState.currentState)
  const subscription = AppState.addEventListener('change', (state) => {
    const previous = foreground
    foreground = nextAppForeground(previous, state)
    if (!previous && foreground) listener()
  })
  return () => subscription.remove()
}
