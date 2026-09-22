import { useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { activitySchema } from '@dovo/protocol'
import { clientScopeKey } from '@dovo/client-runtime'
import { useRuntime } from '../runtime/provider'
import { useNavigation } from '../shell/navigation'
import type { ToolEvents } from './task-tool-events'

export function useToolActivity(taskId: string, visible: boolean, running = false) {
  const { focused } = useNavigation()
  const { read, connected, connection } = useRuntime()
  const identity = `${clientScopeKey(connection)}:${taskId}`
  const [state, setState] = useState<{ identity: string; events: ToolEvents; error: string }>({
    identity,
    events: [],
    error: '',
  })
  useEffect(() => {
    if (!visible || !focused) return
    let stopped = false,
      busy = false
    const load = async () => {
      if (!connected || busy || AppState.currentState !== 'active') return
      busy = true
      try {
        const data = await read(
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
      } catch (error) {
        if (!stopped)
          setState((previous) => ({
            identity,
            events: previous.identity === identity ? previous.events : [],
            error: error instanceof Error ? error.message : String(error),
          }))
      } finally {
        busy = false
      }
    }
    void load()
    const timer = setInterval(() => void load(), running ? 1500 : 10000)
    const resume = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load()
    })
    return () => {
      stopped = true
      clearInterval(timer)
      resume.remove()
    }
  }, [read, connected, taskId, identity, visible, focused, running])
  // Render never exposes a previous computer or task while the new request is pending.
  return state.identity === identity
    ? { events: state.events, error: state.error }
    : { events: [], error: '' }
}
