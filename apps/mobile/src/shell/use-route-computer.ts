import { nativeEffect } from '../runtime/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from '../runtime/application-state'
import { useEffect } from 'react'
import { useRuntime } from '../runtime/provider'
import { useNavigation } from './navigation'

/** A host-qualified link selects its owner only while that route is in the foreground. */
export function useRouteComputer(runtimeId: string) {
  const { ready, activeId, profiles, selectRuntime, selectRuntimeEffect } = useRuntime()
  const { focused } = useNavigation()
  const [error, setError] = useApplicationState('')
  const [retry, setRetry] = useApplicationState(0)
  const saved = profiles.some((profile) => profile.id === runtimeId)
  useEffect(() => {
    if (!ready || !focused || !saved || activeId === runtimeId) return
    let current = true
    setError('')
    void runClientEffect(
      selectRuntimeEffect(runtimeId).pipe(
        Effect.catchAll((cause) =>
          nativeEffect(() => {
            if (current) setError(cause instanceof Error ? cause.message : String(cause))
          }),
        ),
      ),
    )
    return () => {
      current = false
    }
  }, [ready, focused, saved, activeId, runtimeId, selectRuntime, retry])
  return {
    error,
    retry: () => setRetry((value) => value + 1),
  }
}
