import { useEffect } from 'react'
import { AppState } from 'react-native'
import { Effect } from 'effect'
import { activitySchema } from '@dovo/protocol'
import { clientScopeKey, startPolling } from '@dovo/client-runtime'
import { useApplicationState } from '../runtime/application-state'
import { useRuntime } from '../runtime/provider'
import { useNavigation } from '../shell/navigation'
import type { ToolEvents } from './task-tool-events'

export function useToolActivity(taskId: string, visible: boolean, running = false) {
  const { focused } = useNavigation()
  const { readEffect, connected, connection } = useRuntime()
  const identity = `${clientScopeKey(connection)}:${taskId}`
  const [state, setState] = useApplicationState<{
    identity: string
    events: ToolEvents
    error: string
  }>({ identity, events: [], error: '' })
  useEffect(() => {
    if (!visible || !focused || !connected) return
    let stopped = false
    const load = Effect.gen(function* () {
      if (AppState.currentState !== 'active') return
      const data = yield* readEffect(
        '/api/activity',
        { scope: taskId, kind: 'task-activity' },
        activitySchema,
      )
      if (!stopped)
        setState({
          identity,
          events: data.events.filter((event) => event.scope === taskId),
          error: '',
        })
    })
    const polling = startPolling(load, {
      interval: running ? 1500 : 10000,
      onError: (error) => {
        if (!stopped)
          setState((previous) => ({
            identity,
            events: previous.identity === identity ? previous.events : [],
            error: error.message,
          }))
      },
    })
    const resume = AppState.addEventListener('change', (state) => {
      if (state === 'active') polling.refresh()
    })
    return () => {
      stopped = true
      resume.remove()
      void polling.stop()
    }
  }, [readEffect, connected, taskId, identity, visible, focused, running])
  // Render never exposes a previous computer or task while the new request is pending.
  return state.identity === identity
    ? { events: state.events, error: state.error }
    : { events: [], error: '' }
}
