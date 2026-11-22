import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { dashboardReadResultSchema } from '@dovo/protocol'

type Reading = typeof dashboardReadResultSchema.Type

export function useStudioDataSource(
  seconds: number | undefined,
  active: boolean,
  read: () => Promise<Reading>,
  onData?: (value: unknown) => void,
  canRead?: () => boolean,
) {
  const [data, setData] = useState<Reading>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [running, setRunning] = useState(false)
  const lastAttempt = useRef<number | undefined>(undefined)
  const pending = useRef(false)
  const mounted = useRef(false)
  const enabled = useRef(false)
  const available = useRef(active)
  available.current = active

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  async function refresh() {
    if (!available.current || canRead?.() === false || pending.current || !mounted.current) return
    lastAttempt.current = Date.now()
    pending.current = true
    setBusy(true)
    setError('')
    try {
      const result = await read()
      if (mounted.current) {
        setData(result)
        onData?.(result.data)
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      pending.current = false
      if (mounted.current) {
        setBusy(false)
        setAttempt((value) => value + 1)
      }
    }
  }

  const tick = useEffectEvent(() => {
    if (enabled.current) void refresh()
  })
  useEffect(() => {
    if (!active || !running || busy || seconds === undefined) return
    const remaining = (lastAttempt.current ?? Date.now()) + seconds * 1000 - Date.now()
    const timer = setTimeout(() => tick(), Math.max(0, remaining))
    return () => clearTimeout(timer)
  }, [active, running, busy, seconds, attempt])

  return {
    data,
    error,
    busy,
    running,
    refresh,
    start: () => {
      if (!available.current || canRead?.() === false || seconds === undefined || enabled.current)
        return
      enabled.current = true
      setRunning(true)
      void refresh()
    },
    stop: () => {
      enabled.current = false
      setRunning(false)
    },
  }
}
