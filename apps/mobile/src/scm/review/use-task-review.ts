import { useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import {
  createTaskReviewSession,
  taskReviewReportSchema,
  type TaskReviewSessionState,
} from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { useNavigation } from '../../shell/navigation'
export function useTaskReview(taskId: string, version: string, enabled = true) {
  const { read, call, connected, profile } = useRuntime(),
    { focused } = useNavigation()
  const key = JSON.stringify([profile?.id, taskId]),
    active = enabled && focused
  const [value, setValue] = useState<{ key: string; state: TaskReviewSessionState } | null>(null)
  const session = useRef<ReturnType<typeof createTaskReviewSession> | null>(null)
  useEffect(() => {
    if (!connected || !active) return
    const current = createTaskReviewSession(
      taskId,
      (path, input) => (path.endsWith('/read') ? read : call)(path, input, taskReviewReportSchema),
      (state) => setValue({ key, state }),
    )
    session.current = current
    current.visibility(AppState.currentState === 'active')
    const subscription = AppState.addEventListener('change', (state) =>
      current.visibility(state === 'active'),
    )
    return () => {
      current.stop()
      subscription.remove()
      if (session.current === current) session.current = null
    }
  }, [key, read, call, connected, active])
  useEffect(() => {
    void session.current?.refresh()
  }, [key, version])
  const state = value?.key === key ? value.state : null
  return {
    report: state?.report ?? null,
    busy: state?.busy ?? false,
    error: state?.error ?? '',
    refresh: () => session.current?.refresh(),
    run: (
      action: Parameters<ReturnType<typeof createTaskReviewSession>['run']>[0],
      input: Record<string, unknown>,
    ) => session.current?.run(action, input) ?? Promise.resolve(false),
  }
}
export type TaskReviewController = ReturnType<typeof useTaskReview>
