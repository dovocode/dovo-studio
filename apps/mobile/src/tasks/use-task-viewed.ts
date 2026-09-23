import { nativeEffect } from '../runtime/native-effect'
import { Effect } from 'effect'
import { useApplicationState } from '../runtime/application-state'
import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import { clientScopeKey, runClientEffect } from '@dovo/client-runtime'
import { latestCompletedTaskTurn, responses, type Task } from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { useNavigation } from '../shell/navigation'
import { viewedTaskTurn } from './task-view-eligibility'

/** Viewing completion is metadata owned by the source runtime, never by collection prefetch. */
export function useTaskViewed(task: Task, chatVisible: boolean) {
  const { focused } = useNavigation()
  const { call, connected, connection, activeId, profile, snapshot, callEffect } = useRuntime()
  const [appActive, setAppActive] = useApplicationState(AppState.currentState === 'active')
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) =>
      setAppActive(state === 'active'),
    )
    return () => subscription.remove()
  }, [])
  const ownerMatches =
    !!activeId && activeId === profile?.id && !!snapshot?.workspace.tasks.includes(task)
  const visible = focused && chatVisible && appActive && connected && ownerMatches
  const turnId = viewedTaskTurn(task, {
    focused,
    chatVisible,
    appActive,
    connected,
    ownerMatches,
  })
  const completedTurnId = latestCompletedTaskTurn(task)?.id
  const key = `${clientScopeKey(connection)}:${activeId}:${task.id}:${completedTurnId ?? ''}`
  const expectedRevision = task.viewedRevision ?? 0
  const [attempt, retry] = useApplicationState(0)
  const lastAttempt = useRef<{
    key: string
    attempt: number
  } | null>(null)
  const [state, setState] = useApplicationState<{
    key: string
    error: boolean
    busy: boolean
  }>({
    key,
    error: false,
    busy: false,
  })
  useEffect(() => {
    if (!visible) {
      lastAttempt.current = null
      return
    }
    if (!completedTurnId) return
    if (lastAttempt.current?.key === key && lastAttempt.current.attempt === attempt) return
    // Preserve a later explicit "Mark unread" while this same chat remains visible.
    // Also remember a turn that was already read when entering the conversation.
    lastAttempt.current = {
      key,
      attempt,
    }
    if (!turnId || AppState.currentState !== 'active') return
    let current = true
    setState({
      key,
      error: false,
      busy: true,
    })
    void runClientEffect(
      callEffect(
        '/api/tasks/viewed',
        {
          id: task.id,
          turnId,
          expectedRevision,
        },
        responses.ok,
      )
        .pipe(
          Effect.flatMap(() =>
            nativeEffect(() => {
              if (current)
                setState({
                  key,
                  error: false,
                  busy: false,
                })
            }),
          ),
        )
        .pipe(
          Effect.catchAll(() =>
            nativeEffect(() => {
              if (current)
                setState({
                  key,
                  error: true,
                  busy: false,
                })
            }),
          ),
        ),
    )
    return () => {
      current = false
    }
    // Neither snapshot polling nor a failed response automatically retries this write.
    // A new completion, foreground entry, reconnect, or explicit retry can try again.
  }, [call, key, task.id, turnId, completedTurnId, expectedRevision, attempt, visible])
  return {
    error: !!turnId && state.key === key && state.error,
    busy: !!turnId && state.key === key && state.busy,
    retry: () => retry((value) => value + 1),
  }
}
