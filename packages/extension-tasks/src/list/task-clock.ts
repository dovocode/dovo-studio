import { formatThreadAge, threadWorkingSince } from '@dovo/protocol'
import { useCallback, useRef, useSyncExternalStore } from 'react'
import type { Task } from '@dovo/studio-core'
import { subscribeClock } from '@dovo/studio-core/clock'
import { taskPresentation } from './task-presentation'

/** Refresh a Working timer each second while other row labels use a minute cadence. */
export function taskClockInterval(task: Task, now: number, needsInput = false, online = true) {
  const latest = task.turns?.at(-1)
  const started = Date.parse(threadWorkingSince(task, latest) ?? '')
  if (
    online &&
    Number.isFinite(started) &&
    (now - started < 60000 || taskPresentation(task, needsInput, now).state === 'Working')
  )
    return 1000
  return latest?.startedAt || latest?.finishedAt || task.snoozedUntil ? 60000 : null
}

const unsubscribed = () => {}

/**
 * The time a row renders with. It only advances when the row's own label would change, so a
 * running thread updates itself instead of re-rendering the whole sidebar every second.
 */
export function useTaskNow(task: Task, needsInput: boolean, online: boolean) {
  const rendered = useRef<{
    task: Task
    needsInput: boolean
    label: string
    now: number
  } | null>(null)
  const read = () => {
    const now = Date.now()
    const { age, label } = taskPresentation(task, needsInput, now, online)
    const key = `${label}\n${age}`
    const previous = rendered.current
    if (previous?.task === task && previous.needsInput === needsInput && previous.label === key)
      return previous.now
    rendered.current = { task, needsInput, label: key, now }
    return now
  }
  const interval = taskClockInterval(task, Date.now(), needsInput, online)
  const subscribe = useCallback(
    (listener: () => void) =>
      interval === null ? unsubscribed : subscribeClock(interval, listener),
    [interval],
  )
  return useSyncExternalStore(subscribe, read, read)
}

const subscribeMinute = (listener: () => void) => subscribeClock(60000, listener)
export function useThreadAge(statusAt?: string) {
  const time = Date.parse(statusAt ?? '')
  const read = () => formatThreadAge(Date.now() - time)
  return useSyncExternalStore(
    Number.isFinite(time) ? subscribeMinute : () => unsubscribed,
    read,
    read,
  )
}
