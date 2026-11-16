import { useSyncExternalStore } from 'react'

/** One problem-report dialog per window. The command palette and Settings both open it. */
let open = false
const listeners = new Set<() => void>()
function set(value: boolean) {
  if (open === value) return
  open = value
  for (const listener of listeners) listener()
}
export const openReportProblem = () => set(true)
export const closeReportProblem = () => set(false)
export function useReportProblemOpen() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => open,
    () => false,
  )
}
