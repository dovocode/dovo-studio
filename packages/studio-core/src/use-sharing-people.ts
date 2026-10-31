import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AccountClient, PeopleAction, PeopleDirectory } from '@dovo/protocol'

export function useSharingPeople(client: AccountClient, active = true) {
  const [directory, setDirectory] = useState<PeopleDirectory | null>(null)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const scope = JSON.stringify([client.origin, client.sessionId()])
  const context = useMemo(
    () => ({ pending: null as Promise<boolean> | null, mounted: false }),
    [client, scope],
  )
  const current = useRef(context)
  current.current = context
  const valid = useCallback(
    () =>
      current.current === context &&
      context.mounted &&
      scope === JSON.stringify([client.origin, client.sessionId()]),
    [client, scope, context],
  )
  const run = useCallback(
    async (action?: PeopleAction): Promise<boolean> => {
      if (!action && context.pending) return context.pending
      while (context.pending) await context.pending
      if (!valid() || !client.snapshot().directory) return false
      setBusy(true)
      setError('')
      const operation = Promise.resolve().then(async () => {
        try {
          if (!valid()) return false
          const next = action ? await client.updatePeople(action) : await client.people()
          if (!valid()) return false
          setDirectory(next)
          return true
        } catch (cause) {
          if (valid())
            setError(
              cause instanceof Error ? cause.message : 'Could not load friends and organisations',
            )
          return false
        } finally {
          context.pending = null
          if (valid()) setBusy(false)
        }
      })
      context.pending = operation
      return operation
    },
    [client, context, valid],
  )
  useEffect(() => {
    context.mounted = true
    setDirectory(null)
    setBusy(false)
    setError('')
    return () => {
      context.mounted = false
    }
  }, [context])
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined
    const visibility = () => {
      clearInterval(timer)
      timer = undefined
      if (!active || (typeof document !== 'undefined' && document.visibilityState === 'hidden'))
        return
      void run()
      timer = setInterval(() => void run(), 30000)
    }
    visibility()
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visibility)
    return () => {
      clearInterval(timer)
      if (typeof document !== 'undefined')
        document.removeEventListener('visibilitychange', visibility)
    }
  }, [run, active])
  return { directory, busy, error, run }
}
export type SharingPeople = ReturnType<typeof useSharingPeople>
