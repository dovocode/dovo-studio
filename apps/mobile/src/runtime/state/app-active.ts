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
