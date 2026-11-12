import { useSyncExternalStore } from 'react'
import type { RuntimeConnection } from '@dovo/protocol'

type Reveal = { scope: string; messageId: string }
let pending: Reveal | null = null
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
const snapshot = () => pending
export const messageRevealScope = (connection: RuntimeConnection, taskId: string) =>
  JSON.stringify([connection.address, connection.token, taskId])

/** One navigation intention, scoped to the exact computer credential and child thread. */
export function requestMessageReveal(
  connection: RuntimeConnection,
  taskId: string,
  messageId: string,
) {
  pending = { scope: messageRevealScope(connection, taskId), messageId }
  for (const listener of listeners) listener()
}
export function consumeMessageReveal(reveal: Reveal) {
  if (pending !== reveal) return
  pending = null
  for (const listener of listeners) listener()
}
export const useMessageReveal = () => useSyncExternalStore(subscribe, snapshot, snapshot)
