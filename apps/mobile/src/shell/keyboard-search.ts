import { useEffect, useSyncExternalStore } from 'react'

const handlers = new Set<() => void>()
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

export function registerKeyboardSearch(handler: () => void) {
  handlers.add(handler)
  notify()
  return () => {
    handlers.delete(handler)
    notify()
  }
}

export function dispatchKeyboardSearch() {
  const handler = Array.from(handlers).at(-1)
  if (!handler) return false
  handler()
  return true
}

export function useKeyboardSearch(handler: () => void, focused: boolean) {
  useEffect(() => {
    if (focused) return registerKeyboardSearch(handler)
  }, [handler, focused])
}

export function useKeyboardSearchAvailable() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => handlers.size > 0,
    () => false,
  )
}
