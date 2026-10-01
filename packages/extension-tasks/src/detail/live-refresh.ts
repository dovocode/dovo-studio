import { useEffect, useState } from 'react'

type Visibility = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>

/** Serialize reads, pause in the background, and refresh immediately on return. */
export function startLiveRefresh(
  action: () => Promise<void>,
  visibility: Visibility,
  onError: (error: unknown) => void,
  interval = 15_000,
) {
  const visible = () => visibility.visibilityState !== 'hidden'
  let stopped = false
  let running = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const tick = async () => {
    clearTimeout(timer)
    if (stopped || running || !visible()) return
    running = true
    try {
      await action()
    } catch (error) {
      if (!stopped) onError(error)
    } finally {
      running = false
      if (!stopped && visible()) timer = setTimeout(tick, interval)
    }
  }
  const changed = () => {
    clearTimeout(timer)
    if (visible()) void tick()
  }
  visibility.addEventListener('visibilitychange', changed)
  void tick()
  return () => {
    stopped = true
    clearTimeout(timer)
    visibility.removeEventListener('visibilitychange', changed)
  }
}

export function useLiveRefresh(enabled: boolean, action: () => Promise<void>) {
  const [error, setError] = useState('')
  useEffect(() => {
    setError('')
    if (!enabled) return
    let active = true
    const stop = startLiveRefresh(
      async () => {
        await action()
        if (active) setError('')
      },
      document,
      (cause) => setError(cause instanceof Error ? cause.message : String(cause)),
    )
    return () => {
      active = false
      stop()
    }
  }, [enabled, action])
  return error
}
