import { useCallback, useRef, useSyncExternalStore } from 'react'
import type { Task } from '@dovo/studio-core'
import { taskPresentation } from './task-presentation'

type Clock = { listeners: Set<() => void>; timer: ReturnType<typeof setInterval> }
// One timer per cadence, shared by mounted rows and stopped with the last subscriber.
const clocks = new Map<number, Clock>()
function subscribeClock(interval: number, listener: () => void) {
  let clock = clocks.get(interval)
  if (!clock) {
    const listeners = new Set<() => void>()
    clock = {
      listeners,
      timer: setInterval(() => {
        for (const notify of [...listeners]) notify()
      }, interval),
    }
    clocks.set(interval, clock)
  }
  const current = clock
  current.listeners.add(listener)
  return () => {
    current.listeners.delete(listener)
    if (current.listeners.size || clocks.get(interval) !== current) return
    clearInterval(current.timer)
    clocks.delete(interval)
  }
}

/** Running work counts seconds for its first minute; every other label changes per minute. */
export function taskClockInterval(task: Task, now: number) {
  const latest = task.turns?.at(-1)
  const started = Date.parse(latest?.startedAt ?? '')
  if (
    task.status === 'running' &&
    task.runPhase !== 'finalizing' &&
    Number.isFinite(started) &&
    now - started < 60000
  )
    return 1000
  return latest?.startedAt || latest?.finishedAt || task.snoozedUntil ? 60000 : null
}

const unsubscribed = () => {}

/**
 * The time a row renders with. It only advances when the row's own label would change, so a
 * running thread updates itself instead of re-rendering the whole sidebar every second.
 */
export function useTaskNow(task: Task, needsInput: boolean) {
  const rendered = useRef<{
    task: Task
    needsInput: boolean
    label: string
    now: number
  } | null>(null)
  const read = () => {
    const now = Date.now()
    const { label, compactLabel } = taskPresentation(task, needsInput, now)
    const key = `${label}\n${compactLabel}`
    const previous = rendered.current
    if (previous?.task === task && previous.needsInput === needsInput && previous.label === key)
      return previous.now
    rendered.current = { task, needsInput, label: key, now }
    return now
  }
  const interval = taskClockInterval(task, Date.now())
  const subscribe = useCallback(
    (listener: () => void) =>
      interval === null ? unsubscribed : subscribeClock(interval, listener),
    [interval],
  )
  return useSyncExternalStore(subscribe, read, read)
}
