import { useMobilePreferences } from '../../../runtime/preferences/app-preferences'
import { useEffect } from 'react'
import { AppState } from 'react-native'
import { Effect } from 'effect'
import {
  activitySchema,
  retainActivityEvents,
  runtimeSyncOnline,
  watchRuntimeActivity,
} from '@dovo/protocol'
import { clientScopeKey, startPolling } from '@dovo/client-runtime'
import { useApplicationState } from '../../../runtime/state/application-state'
import { useRuntime } from '../../../runtime/connection/provider'
import { useNavigation } from '../../../shell/navigation'
import type { ToolEvents } from './tool-events'

export function useToolActivity(taskId: string, visible: boolean, running = false) {
  const { focused } = useNavigation()
  const { readEffect, connected, connection } = useRuntime()
  const { showToolDetails } = useMobilePreferences()
  const identity = JSON.stringify([clientScopeKey(connection), taskId, showToolDetails])
  const [state, setState] = useApplicationState<{
    identity: string
    events: ToolEvents
    error: string
  }>({ identity, events: [], error: '' })
  useEffect(() => {
    if (!visible || !focused || !connected) return
    let stopped = false
    const unwatch = connection
      ? watchRuntimeActivity(
          connection,
          taskId,
          (incoming) => {
            if (!stopped)
              setState((previous) => ({
                identity,
                events: retainActivityEvents(
                  previous.identity === identity ? previous.events : [],
                  incoming,
                ),
                error: '',
              }))
          },
          showToolDetails,
        )
      : () => {}
    const load = Effect.gen(function* () {
      if (runtimeSyncOnline(connection, taskId) || AppState.currentState !== 'active') return
      const data = yield* readEffect(
        '/api/activity',
        { scope: taskId, kind: 'task-activity', includeDetails: showToolDetails },
        activitySchema,
      )
      if (!stopped && !runtimeSyncOnline(connection, taskId))
        setState((previous) => {
          const incoming = data.events.filter((event) => event.scope === taskId)
          const events =
            previous.identity === identity
              ? retainActivityEvents(previous.events, incoming)
              : incoming
          return previous.identity === identity && !previous.error && events === previous.events
            ? previous
            : { identity, events, error: '' }
        })
    })
    const polling = startPolling(load, {
      interval: running ? 1500 : 10000,
      onError: (error) => {
        if (!stopped && !runtimeSyncOnline(connection, taskId))
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
      unwatch()
      resume.remove()
      void polling.stop()
    }
  }, [readEffect, connected, taskId, identity, visible, focused, running, showToolDetails])
  // Render never exposes a previous computer or task while the new request is pending.
  return state.identity === identity
    ? { events: state.events, error: state.error }
    : { events: [], error: '' }
}
