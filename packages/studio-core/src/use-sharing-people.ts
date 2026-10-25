import { useCallback, useEffect, useRef, useState } from 'react'
import type { AccountClient, PeopleAction, PeopleDirectory } from '@dovo/protocol'

export function useSharingPeople(client: AccountClient) {
  const [directory, setDirectory] = useState<PeopleDirectory | null>(null)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const scope = JSON.stringify([client.origin, client.sessionId()]),
    current = useRef(scope),
    pending = useRef(false)
  current.current = scope
  const run = useCallback(
    async (action?: PeopleAction) => {
      if (pending.current || !client.snapshot().directory) return false
      pending.current = true
      setBusy(true)
      setError('')
      try {
        const next = action ? await client.updatePeople(action) : await client.people()
        if (current.current !== scope) return false
        setDirectory(next)
        return true
      } catch (cause) {
        if (current.current === scope)
          setError(
            cause instanceof Error ? cause.message : 'Could not load friends and organisations',
          )
        return false
      } finally {
        pending.current = false
        if (current.current === scope) setBusy(false)
      }
    },
    [client, scope],
  )
  useEffect(() => {
    setDirectory(null)
    void run()
    const timer = setInterval(() => void run(), 30000)
    return () => clearInterval(timer)
  }, [run])
  return { directory, busy, error, run }
}
export type SharingPeople = ReturnType<typeof useSharingPeople>
