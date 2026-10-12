import { useCallback, useEffect, useRef, useState } from 'react'
import type { TaskWaiting, taskWaitingRequestSchema } from '@dovo/protocol'

type Input = typeof taskWaitingRequestSchema.Type
/** The caller keys the panel by runtime and thread, so requests never cross targets. */
export function useTaskWaiting(
  taskId: string,
  connected: boolean,
  request: (input: Input) => Promise<TaskWaiting>,
) {
  const [data, setData] = useState<TaskWaiting | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const mounted = useRef(false)
  const pending = useRef(false)
  const generation = useRef(0)
  const refresh = useCallback(
    async (unlink?: Input['unlink']) => {
      if (!connected || pending.current) return
      pending.current = true
      const read = ++generation.current
      setBusy(true)
      setError('')
      try {
        const result = await request({ taskId, ...(unlink ? { unlink } : {}) })
        if (mounted.current && generation.current === read) setData(result)
      } catch (cause) {
        if (mounted.current && generation.current === read)
          setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (mounted.current && generation.current === read) {
          pending.current = false
          setBusy(false)
        }
      }
    },
    [taskId, connected, request],
  )
  useEffect(() => {
    mounted.current = true
    setBusy(false)
    void refresh()
    const timer = setInterval(() => void refresh(), 15000)
    return () => {
      mounted.current = false
      generation.current++
      pending.current = false
      clearInterval(timer)
    }
  }, [refresh])
  return { data, error, busy, refresh }
}
