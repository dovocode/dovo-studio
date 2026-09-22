import { useEffect, useState } from 'react'
import { useRuntime } from '../runtime/provider'
import { useNavigation } from './navigation'

/** A host-qualified link selects its owner only while that route is in the foreground. */
export function useRouteComputer(runtimeId: string) {
  const { ready, activeId, profiles, selectRuntime } = useRuntime()
  const { focused } = useNavigation()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const saved = profiles.some((profile) => profile.id === runtimeId)
  useEffect(() => {
    if (!ready || !focused || !saved || activeId === runtimeId) return
    let current = true
    setError('')
    void selectRuntime(runtimeId).catch((cause) => {
      if (current) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => {
      current = false
    }
  }, [ready, focused, saved, activeId, runtimeId, selectRuntime, retry])
  return { error, retry: () => setRetry((value) => value + 1) }
}
