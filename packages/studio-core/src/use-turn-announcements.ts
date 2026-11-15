import { useEffect, useMemo, useRef } from 'react'
import { TurnAnnouncementsTracker, type Task, type TurnAnnouncements } from '@dovo/protocol'

/** A spaced, bounded speech queue. Navigation and mode changes discard queued private content. */
export function useTurnAnnouncements({
  scope,
  task,
  steps,
  mode,
  active,
  announce,
  translate,
}: {
  scope: string
  task: Pick<Task, 'messages' | 'turns' | 'status'>
  steps: readonly { id: string; turnId?: string; status: string; summary: string }[]
  mode: TurnAnnouncements
  active: boolean
  announce: (text: string) => void
  translate?: (text: string) => string
}) {
  const state = useMemo(
    () => ({
      tracker: new TurnAnnouncementsTracker(),
      queue: [] as string[],
      timer: undefined as ReturnType<typeof setTimeout> | undefined,
    }),
    [scope, mode, active],
  )
  const speak = useRef(announce)
  speak.current = announce
  useEffect(
    () => () => {
      clearTimeout(state.timer)
      state.queue.length = 0
    },
    [state],
  )
  useEffect(() => {
    if (!active) return
    const next = state.tracker.update(scope, task, steps, mode, translate)
    state.queue.push(...next)
    // Bound rapid tool bursts. Keep the newest pending information after the current speech.
    if (state.queue.length > 20) state.queue.splice(0, state.queue.length - 20)
    const drain = () => {
      const text = state.queue.shift()
      if (!text) {
        state.timer = undefined
        return
      }
      speak.current(text)
      state.timer = setTimeout(drain, Math.max(2000, text.length * 75))
    }
    if (!state.timer && state.queue.length) drain()
  }, [scope, task, steps, mode, active, state, translate])
}
