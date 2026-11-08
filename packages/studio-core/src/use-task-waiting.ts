import { useCallback, useEffect, useRef, useState } from 'react'
import type { TaskWaiting, taskWaitingRequestSchema } from '@dovo/protocol'

type Input = typeof taskWaitingRequestSchema.Type
const saved = new Map<string, TaskWaiting>()
function remember(key: string, value: TaskWaiting) {
  saved.delete(key)
  saved.set(key, value)
  while (saved.size > 100) saved.delete(saved.keys().next().value!)
}

/** Reads coalesce; confirmed removals wait for the reader rather than being discarded. */
export function useTaskWaiting(
  taskId: string,
  connected: boolean,
  request: (input: Input) => Promise<TaskWaiting>,
  scope?: string,
  active = true,
) {
  const key = scope ? JSON.stringify([scope, taskId]) : undefined
  const [data, setData] = useState<TaskWaiting | null>(() =>
    key ? (saved.get(key) ?? null) : null,
  )
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const mounted = useRef(false)
  const inFlight = useRef<Promise<void> | null>(null)
  const generation = useRef(0)
  const online = useRef(connected)
  online.current = connected
  const refresh = useCallback(
    async (unlink?: Input['unlink']) => {
      const current = generation.current
      if (!online.current) {
        if (unlink && mounted.current)
          setError('Reconnect to stop watching this item. No changes were made.')
        return
      }
      if (!unlink && inFlight.current) return inFlight.current
      while (inFlight.current) await inFlight.current
      if (!mounted.current || current !== generation.current) return
      if (!online.current) {
        if (unlink) setError('Reconnect to stop watching this item. No changes were made.')
        return
      }
      setBusy(true)
      setError('')
      const operation = (async () => {
        try {
          const result = await Promise.resolve().then(() => {
            if (unlink && (!mounted.current || generation.current !== current))
              throw new Error('Watching context changed. No changes were made.')
            if (!online.current)
              throw new Error('Reconnect to update watching items. No changes were made.')
            return request({ taskId, ...(unlink ? { unlink } : {}) })
          })
          if (mounted.current && generation.current === current) {
            if (key) remember(key, result)
            setData(result)
          }
        } catch (cause) {
          if (mounted.current && generation.current === current)
            setError(cause instanceof Error ? cause.message : String(cause))
        } finally {
          if (mounted.current && generation.current === current) {
            inFlight.current = null
            setBusy(false)
          }
        }
      })()
      inFlight.current = operation
      await operation
    },
    [taskId, request, key],
  )
  useEffect(() => {
    mounted.current = true
    setBusy(false)
    setData(key ? (saved.get(key) ?? null) : null)
    setError('')
    return () => {
      mounted.current = false
      generation.current++
      inFlight.current = null
    }
  }, [refresh, key])
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined
    const visibility = () => {
      clearInterval(timer)
      timer = undefined
      if (
        !active ||
        !connected ||
        (typeof document !== 'undefined' && document.visibilityState === 'hidden')
      )
        return
      void refresh()
      timer = setInterval(() => void refresh(), 15000)
    }
    visibility()
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visibility)
    return () => {
      clearInterval(timer)
      if (typeof document !== 'undefined')
        document.removeEventListener('visibilitychange', visibility)
    }
  }, [active, connected, refresh])
  return { data, error, busy, refresh }
}
